// Builds the starter template in headless Chromium and compares the outputs
// with the pinned sdk-commands' own bundler. Needs Playwright's Chromium.
// The last case installs packages from the real npm registry: SKIP_LIVE_REGISTRY=1 leaves it out.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { locatePinnedSdk } from '../scripts/make-sdk-snapshot.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const template = path.resolve(root, '../desktop/templates/starter')
const sdk = locatePinnedSdk()

function readTree(dir, base = dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) readTree(full, base, out)
    else out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full)
  }
  return out
}

const starter = readTree(template)
// the starter plus a composite (main.crdt) and a JSX module
const withComposite = {
  ...starter,
  'assets/scene/main.composite': Buffer.from(
    JSON.stringify({
      version: 1,
      components: [
        {
          name: 'core::Transform',
          data: { 512: { json: { position: { x: 8, y: 1, z: 8 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parent: 0 } } }
        }
      ]
    })
  ),
  'src/ui.tsx': Buffer.from(
    `import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'\n` +
      `export function setupUi(): void {\n` +
      `  ReactEcsRenderer.setUiRenderer(() => (\n` +
      `    <UiEntity uiTransform={{ width: 200, height: 50 }}><Label value="hello" /></UiEntity>\n` +
      `  ))\n}\n`
  ),
  'src/index.ts': Buffer.from(`import { setupUi } from './ui'\n${starter['src/index.ts']}\nsetupUi()\n`)
}

// the starter importing two packages from npm: one with no dependencies, one with a tree of them
const LIVE_DEPENDENCIES = { '@dcl-sdk/utils': '^1.4.0', color: '^4.2.3' }
const withPackages = {
  ...starter,
  'package.json': Buffer.from(
    JSON.stringify({ ...JSON.parse(starter['package.json']), dependencies: { ...JSON.parse(starter['package.json']).dependencies, ...LIVE_DEPENDENCIES } })
  ),
  'src/index.ts': Buffer.from(
    `import * as utils from '@dcl-sdk/utils'\nimport Color from 'color'\n${starter['src/index.ts']}\n` +
      `console.log('LIVE', Color('rgb(255, 0, 0)').hex(), typeof utils.timers.setTimeout)\n`
  )
}

// sdk-commands' bundler, run on a real folder holding the same files
async function nativeBuild(files, production, installed = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-compiler-native-'))
  try {
    for (const [file, bytes] of Object.entries({ ...files, ...installed })) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), bytes)
    }
    fs.mkdirSync(path.join(dir, 'node_modules/@dcl'), { recursive: true })
    fs.symlinkSync(sdk.sdkDir, path.join(dir, 'node_modules/@dcl/sdk'))
    fs.symlinkSync(path.join(dir, 'vendor/asset-packs-stub'), path.join(dir, 'node_modules/@dcl/asset-packs'))
    const fromCommands = createRequire(path.join(sdk.sdkCommandsDir, 'package.json'))
    // the bundle is written before sdk-commands forks tsc: skip the type-check
    const childProcess = fromCommands('child_process')
    const fork = childProcess.fork
    childProcess.fork = () => {
      const child = Object.assign(new EventEmitter(), { killed: true, kill() {} })
      setImmediate(() => child.emit('close', 0))
      return child
    }
    try {
      const silent = () => {}
      await fromCommands('./dist/logic/bundle.js').bundleSingleProject(
        {
          fs: {
            readFile: (file, encoding) => fs.promises.readFile(file, encoding),
            writeFile: (file, data) => fs.promises.writeFile(file, data),
            fileExists: async (file) => fs.existsSync(file)
          },
          logger: { log: silent, info: silent, warn: silent, debug: silent, error: console.error }
        },
        {
          workingDirectory: dir,
          entrypoint: path.join(dir, 'src/index.ts'),
          outputFile: 'bin/index.js',
          tsconfig: path.join(dir, 'tsconfig.json'),
          production,
          watch: false
        }
      )
    } finally {
      childProcess.fork = fork
    }
    const crdt = path.join(dir, 'main.crdt')
    return { bundle: fs.readFileSync(path.join(dir, 'bin/index.js')), crdt: fs.readFileSync(crdt) }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// loads the bundle as the scene runtime does and runs its first frames
async function runBundle(code, logged = []) {
  let sentToRenderer = 0
  const engineApi = {
    crdtGetState: async () => ({ hasEntities: false, data: [] }),
    crdtSendToRenderer: async ({ data }) => {
      sentToRenderer += data.length
      return { data: [] }
    },
    sendBatch: async () => ({ events: [] }),
    subscribe: async () => ({}),
    unsubscribe: async () => ({})
  }
  const anyModule = new Proxy({}, { get: () => async () => ({}) })
  const module = { exports: {} }
  const sceneConsole = { ...console, log: (...parts) => logged.push(parts.join(' ')) }
  const sandbox = { module, exports: module.exports, console: sceneConsole, require: (id) => (id === '~system/EngineApi' ? engineApi : anyModule) }
  vm.runInNewContext(code, sandbox, { filename: 'bin/index.js' })
  const { onStart, onUpdate } = module.exports
  assert.equal(typeof onStart, 'function', 'bundle exports onStart')
  assert.equal(typeof onUpdate, 'function', 'bundle exports onUpdate')
  await onStart()
  await onUpdate(0.016)
  await onUpdate(0.016)
  assert.ok(sentToRenderer > 0, 'the scene sent CRDT state to the renderer')
  return sentToRenderer
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' }
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import * as sceneCompiler from './index.js'
window.sceneCompiler = sceneCompiler
</script>`

const server = http.createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html'
  const file = path.join(dist, name)
  if (name !== 'index.html' && !fs.existsSync(file)) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    'Content-Type': TYPES[path.extname(name)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless'
  })
  response.end(name === 'index.html' ? PAGE : fs.readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch()

const toBase64 = (files) => Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, bytes.toString('base64')]))

// Installs real packages in the browser, builds with them, then builds again with the network off.
async function livePackages() {
  const REGISTRY = 'https://registry.npmjs.org/'
  const context = await browser.newContext()
  const page = await context.newPage()
  const registryRequests = []
  const refused = []
  context.on('request', (request) => request.url().startsWith(REGISTRY) && registryRequests.push(`${request.method()} ${request.url()}`))
  context.on('requestfailed', (request) => request.url().startsWith(REGISTRY) && refused.push(request.url()))
  page.on('pageerror', (err) => console.log(`[page error] ${err.message}`))
  await page.goto(origin)
  await page.waitForFunction(() => window.sceneCompiler !== undefined)

  const helpers = () => {
    const decode = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const encode = (bytes) => {
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(binary)
    }
    const edited = (files, line) => {
      const out = new Map(files)
      out.set('src/index.ts', new TextEncoder().encode(new TextDecoder().decode(files.get('src/index.ts')) + `\n${line}\n`))
      return out
    }
    const newBuilder = () =>
      window.sceneCompiler.createSceneBuilder({ workerUrl: './worker.js', wasmUrl: './esbuild.wasm', snapshotUrl: './sdk-snapshot.json' })
    // a cold worker each time: first build, then a rebuild after an edit, for both kinds of bundle
    const timings = async (files, lock, store) => {
      const out = {}
      for (const production of [true, false]) {
        const builder = newBuilder()
        await builder.ready
        if (lock !== undefined) await builder.setPackages(lock, store)
        const first = await builder.build(files, { production })
        const rebuild = await builder.build(edited(files, 'console.log("edited")'), { production })
        builder.dispose()
        if (!first.ok || !rebuild.ok) throw new Error('timing build failed')
        out[production ? 'production' : 'development'] = { first: first.ms, rebuild: rebuild.ms, bytes: first.outputs.get('bin/index.js').length }
      }
      return out
    }
    return { decode, encode, edited, newBuilder, timings }
  }
  await page.evaluate(`window.liveHelpers = (${helpers})()`)

  const online = await page.evaluate(
    async ({ scenes, dependencies }) => {
      const { resolveDependencies, MemoryPackageStore, PACKAGE_RECEIPT, layoutPackages, parseLock, serializeLock } = window.sceneCompiler
      const { decode, encode, newBuilder, timings } = window.liveHelpers
      const project = (files) => new Map(Object.entries(files).map(([file, base64]) => [file, decode(base64)]))
      const files = project(scenes.withPackages)
      const builder = newBuilder()
      const { snapshot } = await builder.ready
      const store = new MemoryPackageStore()

      const before = await builder.build(files, { production: true })
      const devDependencies = JSON.parse(new TextDecoder().decode(files.get('package.json'))).devDependencies
      let started = performance.now()
      const resolved = await resolveDependencies({ dependencies, devDependencies, store, snapshot })
      const resolveMs = Math.round(performance.now() - started)
      started = performance.now()
      const inUse = await builder.setPackages(resolved.lock, store)
      const setPackagesMs = Math.round(performance.now() - started)
      const build = await builder.build(files, { production: true })

      const installed = {}
      for (const { dir, key } of layoutPackages(resolved.lock, new Set(Object.keys(snapshot.provided))).placements) {
        for (const file of store.list(key)) if (file !== PACKAGE_RECEIPT) installed[`${dir}/${file}`] = encode(store.read(key, file))
      }
      window.live = { builder, store, files, snapshot, dependencies, devDependencies, lockText: serializeLock(resolved.lock) }
      return {
        missing: before.diagnostics.filter((d) => d.missingPackage !== undefined).map((d) => d.missingPackage),
        beforeOk: before.ok,
        lock: resolved.lock,
        lockRoundTrips: JSON.stringify(parseLock(serializeLock(resolved.lock))) === JSON.stringify(resolved.lock),
        warnings: resolved.warnings,
        stats: resolved.stats,
        resolveMs,
        setPackagesMs,
        inUse,
        ok: build.ok,
        diagnostics: build.diagnostics,
        bundle: build.ok ? encode(build.outputs.get('bin/index.js')) : '',
        installed,
        plain: await timings(project(scenes.starter)),
        withPackages: await timings(files, resolved.lock, store)
      }
    },
    {
      scenes: { starter: toBase64(starter), withPackages: toBase64(withPackages) },
      dependencies: JSON.parse(withPackages['package.json']).dependencies
    }
  )

  const packuments = registryRequests.filter((line) => !line.endsWith('.tgz')).length
  assert.deepEqual(refused, [], 'the registry answers a browser on another origin (CORS, under COEP credentialless)')
  assert.ok(registryRequests.every((line) => line.startsWith('GET ')), 'no CORS preflight is sent')
  assert.equal(online.beforeOk, false)
  assert.deepEqual(online.missing.sort(), Object.keys(LIVE_DEPENDENCIES), 'before installing, the build names the missing packages')
  assert.ok(online.ok, `the scene builds with its packages: ${JSON.stringify(online.diagnostics)}`)
  assert.ok(online.lockRoundTrips, 'the lock survives being written to the project and read back')
  const keys = Object.keys(online.lock.packages)
  assert.ok(keys.length > Object.keys(LIVE_DEPENDENCIES).length, 'transitive dependencies are locked too')
  assert.ok(keys.every((key) => /^sha512-/.test(online.lock.packages[key].integrity) && online.lock.packages[key].resolved.startsWith(REGISTRY)))
  console.log(`packages from the real registry: ${keys.join(', ')}`)
  console.log(
    `  resolved and unpacked in ${online.resolveMs} ms: ${packuments} package documents + ${online.stats.downloaded} tarballs ` +
      `(${online.stats.tarballBytes} bytes compressed, ${online.stats.unpackedBytes} bytes unpacked)`
  )
  console.log(`  handed to the build worker in ${online.setPackagesMs} ms: ${online.inUse.files} files, ${online.inUse.bytes} bytes`)
  for (const warning of online.warnings) console.log(`  warning [${warning.code}] ${warning.message}`)

  const browserBundle = Buffer.from(online.bundle, 'base64')
  const installed = Object.fromEntries(Object.entries(online.installed).map(([file, base64]) => [file, Buffer.from(base64, 'base64')]))
  const native = await nativeBuild(withPackages, true, installed)
  assert.ok(browserBundle.equals(native.bundle), 'with the same node_modules on disk, the native bundler writes the same bytes')
  const logged = []
  await runBundle(browserBundle.toString(), logged)
  assert.deepEqual(logged, ['LIVE #FF0000 function'], 'the scene ran the code of both packages')
  console.log(`  bundle ${browserBundle.length} bytes, byte-identical to native over the same node_modules; ran it: ${logged[0]}`)

  const row = (label, t) =>
    `  ${label.padEnd(28)} production ${String(t.production.first).padStart(4)} ms first, ${String(t.production.rebuild).padStart(4)} ms rebuild, ${t.production.bytes} bytes | ` +
    `development ${String(t.development.first).padStart(4)} ms first, ${String(t.development.rebuild).padStart(4)} ms rebuild, ${t.development.bytes} bytes`
  console.log(row('starter', online.plain))
  console.log(row('starter + 2 npm packages', online.withPackages))

  const requestsOnline = registryRequests.length
  await context.setOffline(true)
  const offline = await page.evaluate(async () => {
    const { resolveDependencies, parseLock } = window.sceneCompiler
    const { encode, edited } = window.liveHelpers
    const { builder, store, files, snapshot, dependencies, devDependencies, lockText } = window.live
    const networkDown = await fetch('https://registry.npmjs.org/color', { cache: 'no-store' }).then(
      () => false,
      () => true
    )
    const lock = parseLock(lockText)
    const frozen = await resolveDependencies({ dependencies, devDependencies, lock, store, snapshot })
    await builder.setPackages(null)
    const unset = await builder.build(files, { production: true })
    await builder.setPackages(frozen.lock, store)
    const build = await builder.build(files, { production: true })
    const rebuild = await builder.build(edited(files, 'console.log("offline edit")'), { production: true })
    builder.dispose()
    return {
      networkDown,
      stats: frozen.stats,
      sameLock: JSON.stringify(frozen.lock) === JSON.stringify(lock),
      unsetOk: unset.ok,
      ok: build.ok,
      ms: build.ms,
      rebuildOk: rebuild.ok,
      rebuildMs: rebuild.ms,
      bundle: build.ok ? encode(build.outputs.get('bin/index.js')) : ''
    }
  })
  assert.ok(offline.networkDown, 'the network is blocked for the second build')
  assert.deepEqual({ requests: offline.stats.requests, downloaded: offline.stats.downloaded, reused: offline.stats.reused }, { requests: 0, downloaded: 0, reused: keys.length })
  assert.ok(offline.sameLock && !offline.unsetOk && offline.ok && offline.rebuildOk, 'the frozen project builds from the store and the lock')
  assert.ok(Buffer.from(offline.bundle, 'base64').equals(browserBundle), 'offline, the bundle is the same bytes')
  // the probe is the only thing that reached for the registry after going offline
  assert.deepEqual(registryRequests.slice(requestsOnline), ['GET https://registry.npmjs.org/color'])
  assert.deepEqual(refused, ['https://registry.npmjs.org/color'])
  console.log(`  network blocked: resolved from lock + store with 0 requests, built in ${offline.ms} ms (same bytes), rebuilt after an edit in ${offline.rebuildMs} ms`)
  await context.close()
}

try {
  const page = await browser.newPage()
  page.on('console', (message) => console.log(`[page] ${message.text()}`))
  page.on('pageerror', (err) => console.log(`[page error] ${err.message}`))
  await page.goto(origin)
  await page.waitForFunction(() => window.sceneCompiler !== undefined)

  const result = await page.evaluate(
    async ({ scenes, projectId }) => {
      const { createSceneBuilder, publishPreview, previewRealmUrl, PREVIEW_CACHE_NAME, previewManifestUrl, previewContentUrl } =
        window.sceneCompiler
      const decode = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const encode = (bytes) => {
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(binary)
      }
      const project = (files) => new Map(Object.entries(files).map(([file, base64]) => [file, decode(base64)]))
      const pack = (build) => ({
        ok: build.ok,
        ms: build.ms,
        events: build.events,
        outputs: Object.fromEntries([...build.outputs].map(([file, bytes]) => [file, encode(bytes)]))
      })

      const events = []
      const started = performance.now()
      const builder = createSceneBuilder({
        workerUrl: './worker.js',
        wasmUrl: './esbuild.wasm',
        snapshotUrl: './sdk-snapshot.json',
        onEvent: (event) => events.push(event.type)
      })
      const ready = await builder.ready
      const readyMs = Math.round(performance.now() - started)

      const starter = project(scenes.starter)
      const first = await builder.build(starter, { production: true })
      const edited = new Map(starter)
      edited.set('src/index.ts', new TextEncoder().encode(new TextDecoder().decode(starter.get('src/index.ts')) + '\nconsole.log("edited")\n'))
      const rebuild = await builder.build(edited, { production: true })
      const again = await builder.build(starter, { production: true })
      const dev = await builder.build(starter)
      const composite = await builder.build(project(scenes.withComposite), { production: true })
      const broken = new Map(starter)
      broken.set('src/index.ts', new TextEncoder().encode('import { nope } from "./missing"\nexport function main() { nope( }\n'))
      const failed = await builder.build(broken, { production: true })

      const realmUrl = previewRealmUrl(location.href, projectId)
      const sceneJson = JSON.parse(new TextDecoder().decode(starter.get('scene.json')))
      const publish = () => publishPreview({ realmUrl, projectId, files: starter, buildOutputs: first.outputs, sceneJson, sdkVersion: ready.sdkVersion })
      await publish()
      const published = await publish()
      const cache = await caches.open(PREVIEW_CACHE_NAME)
      const manifest = await (await cache.match(previewManifestUrl(realmUrl))).json()
      const bundleHash = manifest.entity.content.find((entry) => entry.file === 'bin/index.js').hash
      const stored = new Uint8Array(await (await cache.match(previewContentUrl(realmUrl, bundleHash))).arrayBuffer())
      builder.dispose()
      return {
        ready,
        readyMs,
        events,
        first: pack(first),
        rebuild: pack(rebuild),
        again: pack(again),
        dev: pack(dev),
        composite: pack(composite),
        failed: pack(failed),
        published,
        manifest,
        keys: (await cache.keys()).map((request) => request.url),
        storedBundle: encode(stored)
      }
    },
    { scenes: { starter: toBase64(starter), withComposite: toBase64(withComposite) }, projectId: 'starter-check' }
  )

  const bytes = (build, file) => Buffer.from(build.outputs[file] ?? '', 'base64')
  const saved = (build) => build.events.find((event) => event.type === 'bundleSaved')
  console.log(`worker ready in ${result.readyMs} ms: @dcl/sdk ${result.ready.sdkVersion}, esbuild-wasm ${result.ready.esbuildVersion}`)

  assert.ok(result.first.ok, 'the starter builds')
  assert.deepEqual(Object.keys(result.first.outputs), ['bin/index.js'], 'a scene with no composite outputs only the bundle')
  const nativeStarter = await nativeBuild(starter, true)
  const browserBundle = bytes(result.first, 'bin/index.js')
  console.log(`starter (production): browser ${browserBundle.length} bytes, native ${nativeStarter.bundle.length} bytes, first build ${result.first.ms} ms`)
  assert.ok(browserBundle.equals(nativeStarter.bundle), 'the browser bundle is byte-identical to the native one')
  console.log(`  ran it: ${await runBundle(browserBundle.toString())} CRDT bytes sent to the renderer in 3 frames`)

  assert.ok(result.rebuild.ok && !bytes(result.rebuild, 'bin/index.js').equals(browserBundle), 'an edit changes the bundle')
  assert.ok(bytes(result.again, 'bin/index.js').equals(browserBundle), 'undoing the edit restores the same bundle')
  console.log(`  rebuild after an edit ${result.rebuild.ms} ms, and back ${result.again.ms} ms`)

  const devBundle = bytes(result.dev, 'bin/index.js')
  await runBundle(devBundle.toString())
  // module paths (in comments, wrapper keys and the source map) name the install location
  const code = (bundle) =>
    bundle
      .toString()
      .replace(/^\s*\/\/[ #].*$/gm, '')
      .replace(/"[^"\n]*"\((exports|\))/g, '"path"($1')
  assert.ok(code(devBundle) === code((await nativeBuild(starter, false)).bundle), 'the development bundle matches the native one')
  console.log(`starter (development, inline source map): ${devBundle.length} bytes, same code as native apart from module paths, ${result.dev.ms} ms`)

  const nativeComposite = await nativeBuild(withComposite, true)
  assert.deepEqual(Object.keys(result.composite.outputs).sort(), ['bin/index.js', 'main.crdt'])
  assert.ok(bytes(result.composite, 'main.crdt').equals(nativeComposite.crdt), 'main.crdt is byte-identical to the native one')
  assert.ok(bytes(result.composite, 'bin/index.js').equals(nativeComposite.bundle), 'the composite + JSX bundle is byte-identical to the native one')
  await runBundle(bytes(result.composite, 'bin/index.js').toString())
  console.log(`starter + composite + JSX (production): bundle ${nativeComposite.bundle.length} bytes and main.crdt ${nativeComposite.crdt.length} bytes, both identical to native, ${result.composite.ms} ms`)

  assert.equal(result.failed.ok, false)
  assert.deepEqual(result.failed.events.map((event) => event.type), ['buildStarted', 'diagnostics', 'failed'])
  const [diagnostic] = result.failed.events[1].diagnostics
  assert.equal(diagnostic.file, 'src/index.ts')
  console.log(`a broken scene fails with a located diagnostic: ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`)

  assert.deepEqual(saved(result.first) && Object.keys(saved(result.first)).sort(), ['buildId', 'bytes', 'file', 'hash', 'ms', 'type'])
  assert.equal(result.manifest.version, 2, 'each publish bumps the manifest version')
  assert.equal(result.manifest.entity.id, result.published.entityId)
  assert.deepEqual(result.manifest.entity.content.map((entry) => entry.file).sort(), ['bin/index.js', 'scene.json'])
  assert.ok(Buffer.from(result.storedBundle, 'base64').equals(browserBundle), 'the stored bundle is the built one')
  assert.equal(result.keys.length, 3, 'manifest + one entry per content file, nothing stale')
  console.log(`published to ${result.published.realmUrl} as ${result.published.entityId} (${result.keys.length} cache entries)`)
  await page.close()
  if (process.env.SKIP_LIVE_REGISTRY === '1') console.log('packages from the real registry: skipped')
  else await livePackages()
  console.log('browser build check passed')
} finally {
  await browser.close()
  server.close()
}
