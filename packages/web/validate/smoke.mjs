// Loads dist/editor.js into a blank page with a fake host (no engine) and a fake
// HUD Create page in headless Chromium and walks the hosted path: the scene list
// the page mounts (mountHome), a new scene from a starter (built in the page,
// published to the preview store), the docked editor, input pass-through, back
// to the scenes through host.openCreatePage, the trash, a .zip out and in again,
// Back to Decentraland (host.exit), unmount. Then, signed in
// against the in-memory project service, a scene made in one browser context is
// opened in a second one. A .zip whose package.json asks for an npm package is
// imported against a fixture registry and builds again with the registry gone,
// and a scene is published to the fake Worlds server, signed outside the page.
// Needs Playwright's Chromium and a built dist/.
// SMOKE_SCREENSHOTS=<dir> also saves a screenshot of each screen.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { Authenticator } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto.js'
import { chromium } from 'playwright-core'
import { writeZip } from '../src/archive/zip.ts'
import { contentCid } from '../../contract/src/cid.ts'
import { createFakeService } from '../src/sync/fake-service.ts'
import { createFakeWorlds } from './fake-worlds-server.mjs'
import { getUnderlyingServer } from '@dcl/http-server'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { Lifecycle } from '@well-known-components/interfaces'
import { initComponents } from '../../service/src/components.ts'
import { main as serviceMain } from '../../service/src/service.ts'
import { createPiFactory } from '../../service/src/ai/pi.ts'
import { assistantFixture } from '../../service/src/testing/assistant.ts'
import { createMemoryStore } from '../../service/src/store.ts'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const shots = process.env.SMOKE_SCREENSHOTS
const assistantOnly = process.argv.includes('--assistant-only')
const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}
// the HUD's side: its tokens (a brand one off the editor's fallback, to tell them
// apart), its top bar, and a Create page whose body the editor gets
const PAGE = `<!doctype html><html><head><style>
:root { --brand: #ff2d56; --accent: #ff743a; --text: #fcfcfc; --panel: #161518; --r-card: 14px; --r-pill: 999px; --r-control: 10px }
#create-page { position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column; color: #fff;
  font: 10px Inter, sans-serif; background: linear-gradient(135deg, #241336 0%, #3a1a5c 60%, #4b1f73 100%) }
#create-page[hidden] { display: none }
#create-bar { height: 44px; background: var(--panel); display: flex; align-items: center; gap: 6px; padding: 0 14px; color: #8f8d96; flex: none }
#create-bar b { color: #fff; font-size: 14px; margin-right: 40px } #create-bar .on { color: #fff; font-weight: 700; background: #2c2a33; border-radius: 6px; padding: 14px 20px }
#create-rule { height: 3px; background: linear-gradient(90deg, #ff7439, #ff2d55, #c640cd); flex: none }
#create-body { position: relative; flex: 1; min-height: 0; --ui-scale: 1 }
</style></head><body style="margin:0;background:#234">
<canvas id="viewport" tabindex="0" style="position:fixed;inset:0;width:100vw;height:100vh"></canvas>
<div id="editor-container" style="position:fixed;inset:0;pointer-events:none;z-index:10"></div>
<div id="create-page" hidden><div id="create-bar"><b>Decentraland</b><span>COMMUNITIES</span><span>PLACES</span><span>EVENTS</span><span>SHOP</span><span>MAP</span><span>BACKPACK</span><span>GALLERY</span><span>SETTINGS</span><span class="on">CREATE</span></div><div id="create-rule"></div><div id="create-body"></div></div>
</body></html>`

// the signed-in wallet: its key stays here, as the real one stays with the host page
const account = createUnsafeIdentity()
const identity = await Authenticator.initializeAuthChain(account.address, createUnsafeIdentity(), 60, async (message) =>
  Authenticator.createSignature(account, message)
)
const WALLET = account.address
const WORLD = 'smoke.dcl.eth'
const worlds = createFakeWorlds({ worlds: { [WORLD]: { owner: WALLET } } })
let service

// a registry of two packages, one depending on the other
const REGISTRY = 'https://registry.npmjs.org'
function tarball(entries) {
  const blocks = []
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text)
    const header = Buffer.alloc(512)
    header.write(name, 0)
    header.write('0000644\0', 100)
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('        ', 148)
    header.write('0', 156)
    header.write('ustar\x0000', 257)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
const registry = new Map()
function publish(name, version, dependencies, source) {
  const manifest = { name, version, main: 'index.js', dependencies }
  const tgz = tarball({ 'package/package.json': JSON.stringify(manifest), 'package/index.js': source })
  const url = `${REGISTRY}/${name}/-/${name}-${version}.tgz`
  const integrity = 'sha512-' + crypto.createHash('sha512').update(tgz).digest('base64')
  registry.set(url, { body: tgz, contentType: 'application/octet-stream' })
  const document = { name, 'dist-tags': { latest: version }, versions: { [version]: { ...manifest, dist: { tarball: url, integrity } } } }
  registry.set(`${REGISTRY}/${name}`, { body: Buffer.from(JSON.stringify(document)), contentType: 'application/json' })
}
publish('smoke-leaf', '2.0.1', {}, "exports.leaf = 'leaf-of-the-smoke'")
publish('smoke-dep', '1.2.0', { 'smoke-leaf': '^2.0.0' }, "exports.marker = 'marker-of-the-smoke:' + require('smoke-leaf').leaf")
const registryRequests = []
let registryUp = true

// the starter, asking npm for a package and using it
function packedSceneFiles() {
  const template = path.resolve(dist, '../../desktop/templates/starter')
  const files = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      else files.push([prefix + entry.name, fs.readFileSync(path.join(dir, entry.name))])
    }
  }
  walk(template, '')
  return files.map(([name, bytes]) => {
    if (name === 'package.json') {
      const manifest = JSON.parse(bytes.toString())
      manifest.dependencies['smoke-dep'] = '^1.0.0'
      return [name, Buffer.from(JSON.stringify(manifest, null, 2))]
    }
    if (name === 'scene.json') {
      const scene = JSON.parse(bytes.toString())
      scene.display.title = 'Packed scene'
      return [name, Buffer.from(JSON.stringify(scene, null, 2))]
    }
    if (name === 'src/index.ts') return [name, Buffer.from(`import { marker } from 'smoke-dep'\nconsole.log(marker)\n${bytes.toString()}`)]
    return [name, bytes]
  })
}

// the starter with a first line that cannot build
function brokenSceneFiles() {
  return packedSceneFiles().map(([name, bytes]) => {
    if (name === 'package.json') {
      const manifest = JSON.parse(bytes.toString())
      delete manifest.dependencies['smoke-dep']
      return [name, Buffer.from(JSON.stringify(manifest, null, 2))]
    }
    if (name === 'scene.json') {
      const scene = JSON.parse(bytes.toString())
      scene.display.title = 'Broken scene'
      return [name, Buffer.from(JSON.stringify(scene, null, 2))]
    }
    if (name === 'src/index.ts') return [name, Buffer.from(`import './nope'\n${bytes.toString().split('\n').slice(2).join('\n')}`)]
    return [name, bytes]
  })
}

// the fake Worlds content server, under /worlds
async function serveWorlds(request, response, url) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const answer = await worlds.handle(
    new Request(origin + url.pathname.slice('/worlds'.length) + url.search, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : Buffer.concat(chunks)
    }),
    `${origin}/worlds`
  )
  response.writeHead(answer.status, Object.fromEntries(answer.headers))
  response.end(Buffer.from(await answer.arrayBuffer()))
}

// the scene data the in-tab server copy keeps, under the preview realm, as the
// page's service worker serves the toolchain's storage routes there
const previewValues = new Map()
const PREVIEW_VALUES = /^\/preview\/(p[0-9a-f]{32})\/values(?:\/([^/]+))?$/
async function servePreviewValues(request, response, [, realm, key]) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.headers['x-dcl-local-server'] !== 'smoke') return response.writeHead(403).end()
  const values = previewValues.get(realm) ?? new Map()
  previewValues.set(realm, values)
  const json = (status, body) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  if (key === undefined) {
    const data = [...values].map(([k, value]) => ({ key: k, value }))
    return json(200, { data, pagination: { offset: 0, total: data.length } })
  }
  const name = decodeURIComponent(key)
  if (request.method === 'PUT') values.set(name, JSON.parse(Buffer.concat(chunks).toString()).value)
  if (request.method === 'DELETE') values.delete(name)
  if (!values.has(name)) return json(404, { message: 'not found' })
  json(200, { value: values.get(name) })
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/worlds/')) {
    void serveWorlds(request, response, url)
    return
  }
  const previewValuesRoute = PREVIEW_VALUES.exec(url.pathname)
  if (previewValuesRoute !== null) {
    void servePreviewValues(request, response, previewValuesRoute)
    return
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE)
    return
  }
  const file = path.join(dist, url.pathname.replace(/^\/editor\//, ''))
  if (!url.pathname.startsWith('/editor/') || !file.startsWith(dist) || !fs.existsSync(file)) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(response)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const aiFactory = process.env.ASSISTANT_LIVE_AUTH
  ? await createPiFactory(process.env.ASSISTANT_LIVE_AUTH, process.env.ASSISTANT_LIVE_MODEL)
  : assistantFixture
assert.ok((await aiFactory.providers()).some((provider) => provider.available), 'the assistant needs an OAuth session; run packages/service/scripts/assistant-login.ts first')
const assistantData = fs.mkdtempSync(path.join(os.tmpdir(), 'dcl-assistant-smoke-'))
const restoredConversations = []
const startService = (port = '0') => Lifecycle.run({
  initComponents: () => initComponents({
    config: createConfigComponent({
      HTTP_SERVER_HOST: '127.0.0.1', HTTP_SERVER_PORT: port, ALLOWED_ORIGINS: origin,
      AI_AUTH_PATH: path.join(assistantData, '.auth.json'),
      BASE_PATH: '/svc', TICKET_SECRET: 'smoke-secret-smoke-secret-smoke-secret', LOG_LEVEL: 'OFF'
    }),
    store: createMemoryStore(), agentFactory: {
      ...aiFactory,
      create: (...args) => {
        restoredConversations.push(args[3])
        return aiFactory.create(...args)
      }
    }
  }),
  main: async (program) => {
    program.components.server.use(async ({ request, url }, next) => {
      if (!url.pathname.startsWith('/svc/') || url.pathname.startsWith('/svc/assistant/')) return next()
      const headers = {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,x-fake-wallet'
      }
      if (request.method === 'OPTIONS') return { status: 204, headers }
      const answer = await service.handle({
        method: request.method, path: url.pathname.slice('/svc'.length),
        wallet: request.headers.get('x-fake-wallet'), body: new Uint8Array(await request.arrayBuffer())
      })
      return {
        status: answer.status,
        headers: { ...headers, 'content-type': answer.bytes ? 'application/octet-stream' : 'application/json' },
        body: answer.bytes ? Buffer.from(answer.bytes) : JSON.stringify(answer.json)
      }
    })
    await serviceMain(program)
  }
})
let serviceProgram = await startService()
const serviceServer = await getUnderlyingServer(serviceProgram.components.server)
const serviceOrigin = `http://127.0.0.1:${serviceServer.address().port}`
service = createFakeService({ hash: contentCid, baseUrl: `${serviceOrigin}/svc` })

const browser = await chromium.launch()
const problems = []

// A page with the fake host and the editor loaded into it. `signedIn`: a v1 host
// whose wallet signs for the project service; without it, a v0 host and a guest.
async function openEditor(context, { signedIn = false, openProject = null } = {}) {
  // the account badge looks the wallet's profile up; the smoke asks no real server
  await context.route('https://peer.decentraland.org/**', (route) => route.fulfill({ json: { avatars: [] } }))
  await context.route('https://places.decentraland.org/**', (route) => route.fulfill({ json: { data: [] } }))
  await context.route(`${REGISTRY}/**`, (route) => {
    const url = route.request().url()
    registryRequests.push(url)
    const found = registry.get(url)
    if (!registryUp) return route.abort()
    if (found === undefined) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: found.contentType, body: found.body })
  })
  // the wallet's key never enters the page: the host signs out here
  await context.exposeFunction('__signEntity', (entityId) =>
    Authenticator.signPayload(identity, entityId).map((link) => ({ type: link.type, payload: link.payload, signature: link.signature ?? '' }))
  )
  await context.exposeFunction('__signAssistant', (method, url) => {
    const timestamp = String(Date.now())
    const metadata = JSON.stringify({ intent: 'dcl:editor:projects', signer: 'dcl:editor', origin })
    const { pathname, search } = new URL(url)
    const payload = [method, `${pathname}${search}`, timestamp, metadata].join(':').toLowerCase()
    const headers = { 'x-identity-timestamp': timestamp, 'x-identity-metadata': metadata }
    Authenticator.signPayload(identity, payload).forEach((link, i) => { headers[`x-identity-auth-chain-${i}`] = JSON.stringify(link) })
    return headers
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('response', (response) => {
    // the service says 404 for a project it does not have yet and 409 for a stale
    // manifest, and a world has no settings until its owner writes some: answers, not failures
    const url = response.url()
    const expected =
      ([404, 409].includes(response.status()) && url.startsWith(`${serviceOrigin}/svc/`)) ||
      (response.status() === 404 && url.startsWith(`${origin}/worlds/world/`) && url.endsWith('/settings'))
    if (response.status() >= 400 && !expected) problems.push(`${response.status()} ${url}`)
  })
  await page.goto(origin)
  await page.evaluate(
    async ({ wallet, openProject, projects }) => {
      const pageDir = `${location.origin}/`
      const calls = { console: [], modes: [], openPreview: [], spawned: 0, exits: 0, createOpens: 0, homeCloses: 0, bus: [], rpc: [], signed: [], deployments: [], guest: false, canvasClicks: 0, canvasKeys: [], serverLog: [] }
      window.__smoke = calls
      // the HUD's Create page: its body is the editor's while it is open
      let closeHome = null
      window.__openCreate = () => {
        if (closeHome !== null) return
        document.getElementById('create-page').hidden = false
        closeHome = window.__dclEditor.mountHome(document.getElementById('create-body'), {
          close: () => {
            calls.homeCloses++
            window.__closeCreate()
          }
        })
      }
      window.__closeCreate = () => {
        const close = closeHome
        closeHome = null
        document.getElementById('create-page').hidden = true
        close?.()
      }
      window.__manifest = async (id = calls.openPreview.at(-1)?.split('@')[0]) => {
        const stored = await (await caches.open('dcl-editor-preview-v1')).match(`${pageDir}preview/${id}/__manifest`)
        return stored === undefined ? null : await stored.json()
      }
      // the random realm a project is previewed at, and what the preview cache holds
      window.__previewId = async (id) => {
        const root = await navigator.storage.getDirectory()
        const index = await (await (await root.getDirectoryHandle('dcl-editor')).getFileHandle('index.json')).getFile()
        return JSON.parse(await index.text()).projects.find((project) => project.id === id)?.previewId ?? null
      }
      // ids carry a random tail: the projects made under a name, oldest first
      window.__idsOf = async (name) => {
        const root = await navigator.storage.getDirectory()
        const index = await (await (await root.getDirectoryHandle('dcl-editor')).getFileHandle('index.json')).getFile()
        return JSON.parse(await index.text()).projects.filter((project) => project.name.startsWith(name)).sort((a, b) => a.createdAt - b.createdAt).map((project) => project.id)
      }
      window.__previewEntries = async () => (await (await caches.open('dcl-editor-preview-v1')).keys()).map((request) => request.url)
      // every file of a project in this browser, by the hash of its bytes
      window.__projectFiles = async (id) => {
        const hex = async (file) =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('')
        const files = {}
        const walk = async (dir, prefix) => {
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file') files[prefix + name] = await hex(await handle.getFile())
            else await walk(handle, `${prefix}${name}/`)
          }
        }
        const root = await navigator.storage.getDirectory()
        const projects = await (await root.getDirectoryHandle('dcl-editor')).getDirectoryHandle('projects')
        await walk(await projects.getDirectoryHandle(id), '')
        return Object.fromEntries(Object.entries(files).sort())
      }
      const canvas = document.getElementById('viewport')
      canvas.addEventListener('click', () => calls.canvasClicks++)
      canvas.addEventListener('keydown', (e) => {
        calls.canvasKeys.push(`${e.ctrlKey ? 'ctrl+' : ''}${e.key}`)
        // as the engine does: Tab is a game key there
        if (e.key === 'Tab') e.preventDefault()
      })

      const replies = { crdt_snapshot: '{}', crdt_initial: '{}', component_names: '[]', scene_content: '[]' }
      // as the engine: a scene runs from the moment it loads until it is frozen, and
      // cannot be frozen in its first moments
      let frozen = false
      let refusals = 0
      const v0 = {
        version: 0,
        pageDir,
        editorBase: `${pageDir}editor/`,
        busSession: 'smoke123',
        container: document.getElementById('editor-container'),
        engineConsole: async (line) => {
          calls.console.push(line)
          const command = line.split(' ')[0]
          if (command === 'freeze_scene') {
            if (refusals-- > 0) throw new Error('no scene to freeze yet')
            frozen = true
          }
          if (command === 'unfreeze_scene' || command === 'reload') frozen = false
          if (command === 'scene_stats') return frozen ? 'status: blocked({"frozen"})' : 'status: running'
          // the in-tab server copy's console
          if (command === 'scene_logs' && line.endsWith(' --server')) return calls.serverLog.join('\n')
          return replies[command] ?? ''
        },
        identity: () => (wallet === null || calls.guest ? { address: null, isGuest: true } : { address: wallet, isGuest: false }),
        setMode: (mode) => calls.modes.push(mode),
        openPreview: async (projectId, position) => {
          frozen = false
          refusals = 2
          calls.openPreview.push(`${projectId}@${position}`)
        },
        spawnEditorScene: async () => {
          calls.spawned++
          return { hash: 'b64-editor' }
        },
        // the service worker answers a preview's storage to its server copy's token alone
        previewStorageFetch: async (path, init = {}) => {
          const preview = calls.openPreview.at(-1)?.split('@')[0]
          return fetch(`${location.origin}/preview/${preview}${path}`, { ...init, headers: { ...init.headers, 'x-dcl-local-server': 'smoke' } })
        },
        openCreatePage: () => {
          calls.createOpens++
          window.__openCreate()
        },
        exit: () => {
          calls.exits++
          window.__closeCreate()
          window.__dclEditor.unmount()
        }
      }
      window.__dclEditorHost =
        wallet === null
          ? v0
          : {
              ...v0,
              version: 1,
              openProject,
              services: { projects, worldsContent: `${location.origin}/worlds` },
              signedFetch: async (url, init = {}) => {
                if (!url.startsWith(projects)) throw new Error('not-allowed')
                calls.signed.push(`${init.method ?? 'GET'} ${url.slice(projects.length)}`)
                if (url.startsWith(projects + '/assistant/')) {
                  return fetch(url, { ...init, headers: await window.__signAssistant(init.method ?? 'GET', url) })
                }
                return fetch(url, { ...init, headers: { ...init.headers, 'x-fake-wallet': wallet } })
              },
              // the page's own confirmation is the host's to show; this one says yes
              signDeployment: async (request) => {
                calls.deployments.push(request)
                return window.__signEntity(request.entityId)
              }
            }

      // the editor scene's end of the bus, as the sandbox would name it; the scene it
      // finds is the one the page just published
      const bus = new BroadcastChannel('dcl-editor-bus#smoke123')
      const toPage = (msg) => bus.postMessage({ to: 'page', msg })
      bus.onmessage = async ({ data }) => {
        if (data?.to !== 'scene') return
        calls.bus.push(data.msg.type)
        if (data.msg.type === 'rpc') {
          calls.rpc.push(data.msg.method)
          toPage({ type: 'rpc-reply', id: data.msg.id, ok: true, result: null })
        }
        if (data.msg.type !== 'init') return
        const hash = (await window.__manifest()).entity.id
        const scene = { hash, title: 'Smoke scene', parcels: [{ x: 0, y: 0 }], isPortable: false, isBroken: false, isBlocked: false, isSuper: false, sdkVersion: '7' }
        toPage({ type: 'scene-found', scene })
        toPage({ type: 'scene-ready', scene, frozen: false, tool: 'select', orientGlobal: false, pivotEach: false, selected: [], active: null })
      }
    },
    { wallet: signedIn ? WALLET : null, openProject, projects: `${serviceOrigin}/svc` }
  )
  await page.addScriptTag({ type: 'module', url: `${origin}/editor/editor.js` })
  await page.waitForFunction(() => window.__dclEditor !== undefined)
  // as the HUD does on Create, or once in-world with ?editor
  await page.evaluate(() => window.__openCreate())
  return page
}

const size = { viewport: { width: 1440, height: 900 } }
const page = await openEditor(await browser.newContext(size))

let step = 0
const ok = (what) => console.log(`  ok ${++step} ${what}`)
const shot = async (name, of = page) => {
  if (!shots) return
  fs.mkdirSync(shots, { recursive: true })
  await of.screenshot({ path: path.join(shots, `${name}.png`) })
}
const uiOf = (of) => of.locator('#editor-container > #editor-ui-host')
const homeOf = (of) => of.locator('#create-body #editor-ui-host')
const ui = uiOf(page)
const home = homeOf(page)
// Import is a menu where the browser can also pick a folder
const importZip = async (of, file) => {
  const chooser = of.waitForEvent('filechooser')
  await homeOf(of).getByRole('button', { name: 'Import', exact: true }).click()
  const zipItem = homeOf(of).getByRole('button', { name: 'A .zip file' })
  if (await zipItem.count()) await zipItem.click()
  await (await chooser).setFiles(file)
}
const backToScenes = async (of = page) => {
  await uiOf(of).locator('.eui-topbar-home').click()
  await homeOf(of).locator('.eui-create').waitFor()
}
const until = async (what, done) => {
  for (let waited = 0; !done(); waited += 100) {
    assert.ok(waited < 30_000, `timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
// type at the top of src/index.ts in the code editor and save
const saveCode = async (of, text) => {
  const view = uiOf(of)
  await view.getByRole('button', { name: 'Code', exact: true }).click()
  await view.locator('.cm-content').click()
  await of.keyboard.press('ControlOrMeta+Home')
  await of.keyboard.type(text)
  await of.keyboard.press('ControlOrMeta+s')
  await view.locator('.eui-studio-filehead', { hasText: 'Saved' }).waitFor()
  await view.locator('.eui-studio-hbtn').click()
}
const reloads = () => page.evaluate(() => window.__smoke.console.filter((line) => line.startsWith('reload')).length)

async function checkGuestEditor() {
  // 1. the scene list, in the HUD's Create page, in the HUD's look and with no sign-in of its own
  await home.locator('.eui-create').waitFor()
  await home.getByRole('tab', { name: 'Your scenes' }).waitFor()
  await home.getByText('Build scenes right here. Open one to walk into it and start building.').waitFor()
  assert.equal(await home.locator('.eui-create-card').count(), 0, 'no scenes yet')
  assert.equal(await home.locator('.eui-create-tile').count(), 1, 'the New scene tile')
  assert.equal(await home.locator('.eui-welcome').count(), 0, 'no welcome gate')
  assert.equal(await home.getByRole('button', { name: /sign in/i }).count(), 0, 'no sign-in button')
  assert.equal(await home.getByText(/Decentraland Studio|project/).count(), 0, 'named Create and scenes')
  assert.equal(await home.getByText('Scenes stay on this device.').count(), 1, 'one line says where the scenes are kept')
  assert.equal(await home.locator('.eui-create-action.primary').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 45, 86)', 'the HUD’s --brand reaches the shadow root')
  assert.equal(await ui.count(), 0, 'no docked editor yet')
  assert.equal(await page.locator('head link[href$="/editor/editor.css"]').count(), 1, 'the font stylesheet is linked')
  assert.deepEqual(await page.evaluate(() => window.__smoke.modes), [], 'the scene list changes no host mode')
  await shot('1-home-empty')
  ok('mountHome draws the scene list in the Create page, in the HUD’s tokens, as a guest, without a sign-in or a mode change')

  // 2. a new scene from a starter: kept in this browser, with no folder to choose
  await home.getByRole('button', { name: '+ New scene' }).click()
  await home.getByText('Example', { exact: true }).click()
  assert.equal(await home.getByText('Location').count(), 0, 'no location to pick')
  await home.locator('.eui-home-modal input').fill('Smoke scene')
  await shot('1b-home-new-scene')
  await home.getByRole('button', { name: 'Create scene' }).click()

  // 3. it is built in the page and published where the service worker serves the realm from
  await page.waitForFunction(() => window.__smoke.spawned === 1, null, { timeout: 120_000 })
  const [smokeId] = await page.evaluate(() => window.__idsOf('Smoke scene'))
  assert.match(smokeId, /^smoke-scene-[a-z0-9]{4}$/, 'a new scene’s id has a random tail')
  const smokePreview = await page.evaluate((id) => window.__previewId(id), smokeId)
  assert.match(smokePreview ?? '', /^p[0-9a-f]{32}$/, 'the preview realm is a random id kept with the project')
  assert.deepEqual(await page.evaluate(() => window.__smoke.openPreview), [`${smokePreview}@0,0`])
  assert.ok(!(await page.evaluate(() => window.__previewEntries())).some((url) => url.includes(`/preview/${smokeId}/`)), 'nothing is served under the scene’s name')
  const published = await page.evaluate(async (realm) => {
    const { version, entity } = await window.__manifest()
    const cache = await caches.open('dcl-editor-preview-v1')
    const bundle = entity.content.find((entry) => entry.file === 'bin/index.js')
    const stored = bundle && (await cache.match(`${location.origin}/preview/${realm}/content/contents/${bundle.hash}`))
    return {
      version,
      id: entity.id,
      title: entity.metadata.display.title,
      pointers: entity.pointers,
      files: entity.content.map((entry) => entry.file).sort(),
      bundleBytes: stored ? (await stored.arrayBuffer()).byteLength : 0,
      machineId: localStorage.getItem('dcl-editor.machineId')
    }
  }, smokePreview)
  assert.equal(published.title, 'Smoke scene')
  assert.deepEqual(published.pointers, ['0,0'])
  assert.ok(published.files.includes('bin/index.js') && published.files.includes('scene.json'), published.files.join(' '))
  assert.ok(published.bundleBytes > 100_000, `the bundle is stored (${published.bundleBytes} bytes)`)
  const sentMachineId = atob(published.id.slice(4)).slice(`/preview/${smokePreview}-`.length)
  assert.match(sentMachineId, /^[A-Za-z0-9_.]+$/)
  assert.ok(published.machineId !== null && sentMachineId !== published.machineId, 'the entity id never carries the browser secret, so wallets on one browser are not linked')
  ok(`the starter is built in the page and published: ${published.files.length} files, bundle ${published.bundleBytes} bytes, then host.openPreview + host.spawnEditorScene`)

  // 4. the bus carries the tab's session; the page closes and the docked editor comes up
  assert.equal(await page.evaluate(() => window.__smoke.homeCloses), 1, 'opening a scene closes the Create page')
  assert.equal(await home.count(), 0, 'the scene list is gone with the page')
  await ui.locator('.eui-toolbar').waitFor()
  await ui.locator('.eui-topbar').waitFor()
  assert.equal(await ui.locator('.eui-loading').count(), 0, 'no loading overlay')
  assert.equal(await page.locator('iframe').count(), 0, 'no engine iframe')
  const lines = await page.evaluate(() => window.__smoke.console)
  assert.ok(lines.includes('scene_stats') && lines.includes('crdt_snapshot'), `console lines through the host: ${lines.join(' | ')}`)
  await shot('2-editor')
  ok(`the editor attaches over dcl-editor-bus#<session>; console lines go through host.engineConsole (${lines.length})`)

  // the scene ran until the editor paused it: that is not the creator playing
  await page.waitForFunction(() => window.__smoke.console.filter((line) => line === 'freeze_scene').length === 3)
  await page.waitForTimeout(500)
  assert.deepEqual([...new Set(await page.evaluate(() => window.__smoke.modes))], ['edit'], 'the host mode never left edit')
  assert.equal(await ui.locator('.eui-ltab.active').textContent(), 'Prefabs', 'an empty scene opens on the built-in prefabs, as on desktop')
  assert.equal(await ui.locator('.eui-toolbar [aria-pressed]').count(), 0, 'no mute button: the volume is the host page’s')
  assert.equal(await ui.locator('.eui-toolbar.compact').count(), 0, 'the desktop toolbar, not refitted between the docks')
  ok('attaching keeps the host in edit mode; no mute; the toolbar is the desktop one')

  // keyboard: Tab on the engine canvas goes back into the editor, and every button can be named
  await page.locator('#viewport').focus()
  await page.keyboard.press('Tab')
  assert.equal(await ui.evaluate((host) => host.shadowRoot.activeElement?.tagName ?? null), 'BUTTON', 'Tab on the canvas lands on the editor’s first control')
  const unnamed = await ui.evaluate((host) =>
    [...host.shadowRoot.querySelectorAll('button')]
      .filter((b) => b.checkVisibility() && (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/[^\p{L}\p{N}]/gu, '') === '')
      .map((b) => b.className)
  )
  assert.deepEqual(unnamed, [], 'every visible button has a name')
  assert.equal(await page.evaluate(() => window.__smoke.canvasKeys.filter((k) => k === 'Tab').length), 0, 'the engine never heard the Tab')
  ok('Tab on the engine canvas comes back to the editor, and every visible button has a name')

  // 5. a click in the gap between the docks reaches the canvas; a click on a panel does not
  const gap = { x: 720, y: 500 }
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, gap), 'viewport')
  await page.mouse.click(gap.x, gap.y)
  assert.equal(await page.evaluate(() => window.__smoke.canvasClicks), 1, 'the gap click reached the canvas')
  const bar = await ui.locator('.eui-topbar-title').boundingBox()
  await page.mouse.click(bar.x + 4, bar.y + 4)
  assert.equal(await page.evaluate(() => window.__smoke.canvasClicks), 1, 'a click on the top bar stays in the editor')
  ok('a click in a gap reaches the canvas underneath; a click on a panel does not')

  // 6. Cmd/Ctrl+click in the viewport is relayed as an editor pick
  await page.keyboard.down('Meta')
  await page.mouse.click(gap.x, gap.y)
  await page.keyboard.up('Meta')
  await page.waitForFunction(() => window.__smoke.bus.includes('pick-at-pointer'))
  ok('Cmd/Ctrl+click on the canvas is relayed to the scene as pick-at-pointer')

  // 7. with the canvas focused, an editor chord stays out of the engine; a plain key does not
  await page.focus('#viewport')
  await page.keyboard.press('Control+g')
  await page.keyboard.press('w')
  assert.deepEqual(await page.evaluate(() => window.__smoke.canvasKeys.filter((k) => k !== 'ctrl+Control')), ['w'])
  ok('Ctrl+G is kept from the canvas, W still reaches it')

  // 8. the hosted keymap: Alt+W is the move tool (Ctrl/Cmd+W would close the tab)
  const toolChanges = () => page.evaluate(() => window.__smoke.bus.filter((type) => type === 'set-tool').length)
  const toolsBefore = await toolChanges()
  await page.keyboard.press('Alt+KeyW')
  await page.waitForFunction((n) => window.__smoke.bus.filter((type) => type === 'set-tool').length > n, toolsBefore)
  ok('Alt+W switches tool')

  // 9. the code editor: a save that cannot build says where, the fix clears it, and
  // the scene is restarted by its id each time
  await ui.getByRole('button', { name: 'Code', exact: true }).click()
  await ui.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type("import './nope'\n")
  await page.keyboard.press('ControlOrMeta+s')
  const banner = ui.locator('.eui-stall-notice', { hasText: 'Your scene has a code error' })
  await banner.waitFor()
  assert.match(await banner.textContent(), /src\/index\.ts:1:\d+: ERROR: Could not resolve "\.\/nope"/)
  assert.equal(await banner.getByRole('button', { name: 'index.ts:1' }).count(), 1, 'the error links to its line')
  const saved = ui.locator('.eui-studio-filehead', { hasText: 'Saved' })
  await saved.waitFor()
  assert.equal((await page.evaluate(() => window.__manifest())).version, 1, 'a failed build is not published')
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ControlOrMeta+s')
  await banner.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.__smoke.console.filter((line) => line.startsWith('reload')).length === 2)
  await saved.waitFor()
  assert.equal((await page.evaluate(() => window.__manifest())).version, 2, 'the fixed build is published')
  assert.deepEqual(
    await page.evaluate(() => window.__smoke.console.filter((line) => line.startsWith('reload'))),
    [`reload ${published.id}`, `reload ${published.id}`],
    'the edited scene is reloaded by its id'
  )
  ok('a save that cannot build shows the error at its line; the fix clears it; the scene reloads by id')

  // a second save while the first one's restart is still under way gets its own reload
  const reloaded = await reloads()
  await page.keyboard.type('// one\n')
  await page.keyboard.press('ControlOrMeta+s')
  await page.keyboard.type('// two\n')
  await page.keyboard.press('ControlOrMeta+s')
  await page.waitForFunction((count) => window.__smoke.console.filter((line) => line.startsWith('reload')).length === count + 2, reloaded)
  await saved.waitFor()
  assert.equal(await page.evaluate(() => window.__smoke.console.some((line) => line.startsWith('move_player_to'))), false, 'no /move_player_to: the host has no such command')
  await ui.locator('.eui-studio-hbtn').click()
  await ui.locator('.eui-toolbar').waitFor()
  ok('two saves in a row are two reloads; the player is never moved with a console command')

  // the in-tab server copy: its console in the logs as desktop shows its Multiplayer Server's, its data in Storage
  const reloadsBeforeServer = await reloads()
  await page.evaluate(() => window.__smoke.serverLog.push('[1.00] Log: [server] round 1 starts', '[1.10] Log: the copy warms up'))
  await ui.getByRole('button', { name: 'Show build / server logs' }).click()
  const logTab = (name) => ui.locator('.eui-logs-tabs button', { hasText: name })
  await logTab('Game').click()
  await ui.locator('.eui-logs-line', { has: page.locator('.eui-logs-role.server') }).filter({ hasText: 'round 1 starts' }).waitFor()
  assert.equal(await ui.locator('.eui-logs-line', { hasText: 'the copy warms up' }).count(), 0, 'an untagged server line stays out of Game')
  await page.evaluate(() => window.__smoke.serverLog.push('[2.00] Log: [server] round 2 starts'))
  await ui.locator('.eui-logs-line', { hasText: 'round 2 starts' }).waitFor()
  await logTab('Build').click()
  const buildText = await ui.locator('.eui-logs-body').textContent()
  assert.equal(buildText.split('round 1 starts').length - 1, 1, 'each server line is relayed once')
  assert.ok(buildText.includes('the copy warms up'), 'the copy’s other lines are in Build')
  await logTab('Storage').click()
  await ui.getByText('Nothing stored yet.').waitFor()
  await ui.getByRole('button', { name: '+ Add value' }).click()
  await ui.locator('.eui-value-modal input').fill('best-time')
  await ui.locator('.eui-value-modal textarea').fill('{ "seconds": 42 }')
  await ui.locator('.eui-value-modal').getByRole('button', { name: 'Save' }).click()
  await ui.locator('.eui-value-row', { hasText: 'best-time' }).waitFor()
  assert.deepEqual(previewValues.get(smokePreview)?.get('best-time'), { seconds: 42 }, 'written to the preview realm’s storage')
  assert.equal(await ui.getByRole('button', { name: 'Delete all data' }).count(), 0, 'no bulk delete: the preview has no such route')
  assert.equal(await reloads(), reloadsBeforeServer, 'reading the server copy reloads nothing')
  await shot('2b-preview-storage')
  await ui.getByRole('button', { name: 'Hide logs' }).first().click()
  ok('the server copy’s [server] lines reach Game once each, its other lines Build; Storage reads and writes the preview realm; no reload')

  // 10. back to the scenes, on the Create page the host opens again, and in again, in the same page
  await backToScenes()
  await page.waitForFunction(async () => (await window.__previewEntries()).length === 0, null, { timeout: 10_000 })
  assert.equal(await page.evaluate(() => window.__smoke.createOpens), 1, 'back to scenes asks the host for its Create page')
  assert.equal(await page.evaluate(() => window.__smoke.modes.at(-1)), 'off', 'the HUD is back for its page')
  assert.equal(await ui.locator('.eui-toolbar').count(), 0, 'the editor is gone')
  const smokeCard = home.locator('.eui-create-card', { hasText: 'Smoke scene' })
  assert.match(await smokeCard.textContent(), /On this device only · opened just now/)
  assert.match(await smokeCard.textContent(), /Not published/)
  assert.equal(await home.getByText(smokeId).count(), 0, 'the id is never shown')
  await shot('3-home-cards')
  await page.setViewportSize({ width: 1280, height: 720 })
  await shot('3-home-cards-1280x720')
  await page.setViewportSize(size.viewport)
  await smokeCard.click()
  await page.waitForFunction(() => window.__smoke.spawned === 2)
  await ui.locator('.eui-toolbar').waitFor()
  assert.deepEqual(await page.evaluate(() => window.__smoke.openPreview), [`${smokePreview}@0,0`, `${smokePreview}@0,0`])
  assert.ok((await page.evaluate(() => window.__manifest())) !== null, 'the preview left with the scene; opening it again publishes again')
  assert.equal(
    await page.evaluate(() => window.__smoke.console.filter((line) => line === 'reload b64-editor').length),
    1,
    'the editor scene is restarted for the next project, by its hash'
  )
  ok('back to the scenes through host.openCreatePage, the preview cleared, and into the scene again without a page load')

  // 11. a deleted scene goes to the trash and comes back from it
  await backToScenes()
  const card = home.locator('.eui-create-card:not(.trashed)')
  await card.click({ button: 'right' })
  await home.locator('.eui-create-card .eui-scene-menu').waitFor()
  await page.waitForTimeout(300)
  await shot('3b-home-menu')
  await home.getByRole('button', { name: 'Move to trash', exact: true }).click()
  await card.waitFor({ state: 'detached' })
  await home.locator('.eui-toast').getByRole('button', { name: 'Undo' }).waitFor()
  await home.getByRole('tab', { name: 'Trash' }).click()
  await home.locator('.eui-create-card.trashed').getByText('Deleted for good in 30 days').waitFor()
  await shot('3c-home-trash')
  await home.locator('.eui-create-card.trashed').getByRole('button', { name: 'Restore' }).click()
  await home.getByText('The trash is empty.').waitFor()
  await home.getByRole('tab', { name: 'Your scenes' }).click()
  await card.getByText('Smoke scene').waitFor()
  ok('Move to trash hides the scene and offers Undo; Trash says when it goes for good; Restore brings it back')

  // a scene leaves as a .zip and comes back as the same files
  const download = page.waitForEvent('download')
  await card.click({ button: 'right' })
  await home.getByRole('button', { name: 'Export as .zip', exact: true }).click()
  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dcl-editor-smoke-')), 'smoke-scene.zip')
  await (await download).saveAs(zip)
  await importZip(page, zip)
  await home.getByText('Scene imported').waitFor()
  await shot('3d-imported')
  await home.getByRole('button', { name: 'Done' }).click()
  const importedId = (await page.evaluate(() => window.__idsOf('Smoke scene')))[1]
  const [exported, imported] = await page.evaluate(async (ids) => [await window.__projectFiles(ids[0]), await window.__projectFiles(ids[1])], [smokeId, importedId])
  assert.ok(Object.keys(exported).includes('scene.json') && Object.keys(exported).includes('src/index.ts'), Object.keys(exported).join(' '))
  assert.deepEqual(imported, exported, 'the imported project has the exported files, byte for byte')
  fs.rmSync(path.dirname(zip), { recursive: true, force: true })
  ok(`export as .zip, then import: the same ${Object.keys(exported).length} files`)

  // 12. Back to Decentraland is host.exit(); unmount leaves nothing behind, and the Create page lists the scenes again
  const announced = () => page.evaluate(() => window.__smoke.bus.filter((type) => type === 'init').length)
  await home.locator('.eui-create-card', { hasText: 'Smoke scene' }).first().click()
  await ui.locator('.eui-toolbar').waitFor()
  await ui.locator('.eui-topbar-menu-wrap button[data-tip="Settings"]').click()
  await ui.getByRole('button', { name: 'Back to Decentraland' }).click()
  await page.waitForFunction(() => window.__smoke.exits === 1)
  assert.equal(await page.locator('#editor-container > *').count(), 0, 'the container is empty')
  assert.equal(await page.locator('#create-body > *').count(), 0, 'the Create page body is empty')
  assert.equal(await page.locator('head link[href$="/editor/editor.css"]').count(), 0, 'the stylesheet is gone')
  assert.equal(await page.evaluate(() => window.__smoke.modes.at(-1)), 'off')
  await page.waitForFunction(async () => (await window.__previewEntries()).length === 0, null, { timeout: 10_000 })
  const before = await announced()
  await page.waitForTimeout(1500)
  assert.equal(await announced(), before, 'no more announcements on the bus')
  await page.evaluate(() => window.__openCreate())
  await home.locator('.eui-create-card', { hasText: 'Smoke scene' }).first().waitFor()
  ok('Back to Decentraland calls host.exit(); unmount() empties the container and restores the HUD mode; mountHome lists the scenes again')

  // a scene that asks npm for a package: downloaded once, frozen, and built again with the registry gone
  const packed = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dcl-editor-smoke-')), 'packed-scene.zip')
  fs.writeFileSync(packed, await writeZip(packedSceneFiles()))
  await importZip(page, packed)
  await home.getByText('Scene imported').waitFor()
  await home.getByText('It uses 1 package from npm (smoke-dep).', { exact: false }).waitFor()
  await home.getByText('Ready: smoke-dep 1.2.0, and 1 package they depend on.').waitFor()
  await shot('3e-imported-packages')
  const spawnedBefore = await page.evaluate(() => window.__smoke.spawned)
  await home.getByRole('button', { name: 'Open scene' }).click()
  await page.waitForFunction((n) => window.__smoke.spawned === n + 1, spawnedBefore, { timeout: 120_000 })
  const bundleOf = (slug) =>
    page.evaluate(async (slug) => {
      const id = await window.__previewId(slug)
      const { version, entity } = await window.__manifest(id)
      const bundle = entity.content.find((entry) => entry.file === 'bin/index.js')
      const stored = await (await caches.open('dcl-editor-preview-v1')).match(`${location.origin}/preview/${id}/content/contents/${bundle.hash}`)
      return { version, text: await stored.text() }
    }, slug)
  const [packedId] = await page.evaluate(() => window.__idsOf('Packed scene'))
  const online = await bundleOf(packedId)
  assert.ok(online.text.includes('marker-of-the-smoke:') && online.text.includes('leaf-of-the-smoke'), 'the bundle holds the package and the package it depends on')
  const lock = JSON.parse(await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory()
    const project = await (await (await root.getDirectoryHandle('dcl-editor')).getDirectoryHandle('projects')).getDirectoryHandle(id)
    return (await (await project.getFileHandle('dcl-editor.lock.json')).getFile()).text()
  }, packedId))
  assert.deepEqual(Object.keys(lock.packages), ['smoke-dep@1.2.0', 'smoke-leaf@2.0.1'])
  assert.match(lock.packages['smoke-dep@1.2.0'].integrity, /^sha512-/)
  assert.deepEqual([...registryRequests].sort(), [...registry.keys()].sort(), 'two package documents and two tarballs, once each')
  assert.ok(!Object.keys(await page.evaluate((id) => window.__projectFiles(id), packedId)).some((file) => file.includes('node_modules')), 'no package file among the project files')
  registryUp = false
  await ui.locator('.eui-toolbar').waitFor()
  await ui.getByRole('button', { name: 'Code', exact: true }).click()
  await ui.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('// built with the registry gone\n')
  await page.keyboard.press('ControlOrMeta+s')
  await page.waitForFunction(async ([id, version]) => (await window.__manifest(await window.__previewId(id))).version > version, [packedId, online.version])
  await ui.locator('.eui-studio-hbtn').click()
  const offline = await bundleOf(packedId)
  assert.ok(offline.text.includes('marker-of-the-smoke:'), 'the rebuilt bundle still holds the package')
  await backToScenes()
  await home.locator('.eui-create-card').getByText('Packed scene').click()
  await page.waitForFunction((n) => window.__smoke.spawned === n + 2, spawnedBefore, { timeout: 120_000 })
  assert.ok((await bundleOf(packedId)).text.includes('marker-of-the-smoke:'), 'opened again, it builds from the frozen packages')
  assert.equal(registryRequests.length, registry.size, 'a frozen project asks the registry for nothing')
  registryUp = true
  fs.rmSync(path.dirname(packed), { recursive: true, force: true })
  await ui.locator('.eui-toolbar').waitFor()
  assert.equal(await ui.locator('.eui-topbar-publish').count(), 0, 'no Publish on a host that cannot sign (v0)')
  await backToScenes()
  // the HUD closing its page (its ✕, or another page) only takes the list away
  const exitsBefore = await page.evaluate(() => window.__smoke.exits)
  await page.evaluate(() => window.__closeCreate())
  assert.equal(await page.locator('#create-body > *').count(), 0, 'the list is gone with the page')
  await page.evaluate(() => window.__openCreate())
  await home.locator('.eui-create-card', { hasText: 'Packed scene' }).waitFor()
  assert.equal(await page.evaluate(() => window.__smoke.exits), exitsBefore, 'closing the page is not an exit')
  ok(`a .zip that asks npm for a package: ${Object.keys(lock.packages).join(' and ')} are downloaded once and frozen; it rebuilds and reopens with the registry unreachable; the Create page closes and opens again`)

  // a scene whose first build fails stays open: the error screen opens its code at the line
  const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dcl-editor-smoke-')), 'broken-scene.zip')
  fs.writeFileSync(broken, await writeZip(brokenSceneFiles()))
  await importZip(page, broken)
  await home.getByText('Scene imported').waitFor()
  await home.getByRole('button', { name: 'Open scene' }).click()
  const failedCard = ui.locator('.eui-loading-card')
  await failedCard.getByText('Your scene has a code error').waitFor({ timeout: 120_000 })
  await shot('3c-first-build-failed')
  await failedCard.getByRole('button', { name: 'Open the code' }).click()
  await ui.locator('.cm-content').waitFor()
  assert.match(await ui.locator('.cm-content').textContent(), /import '\.\/nope'/, 'the failing file is open')
  await shot('3d-code-from-the-error')
  await ui.locator('.eui-studio-hbtn').click()
  await failedCard.getByRole('button', { name: 'Open the code' }).waitFor()
  await failedCard.getByRole('button', { name: 'Back to scenes' }).click()
  await home.locator('.eui-create').waitFor()
  fs.rmSync(path.dirname(broken), { recursive: true, force: true })
  ok('a scene whose first build fails stays open: “Open the code” shows the failing file, and the error screen is still there to leave from')

  assert.equal(service.log.length, 0, 'a guest on a v0 host asked the project service for nothing')
}

async function checkSignedEditor() {
  // signed in, a scene made in one browser is on the account and opens in another
  const first = await openEditor(await browser.newContext(size), { signedIn: true })
  const one = uiOf(first)
  const oneHome = homeOf(first)
  await oneHome.getByText('Synced with your account.').waitFor()
  await oneHome.getByRole('button', { name: '+ New scene' }).click()
  await oneHome.getByText('Example', { exact: true }).click()
  await oneHome.locator('.eui-home-modal input').fill('Shared scene')
  await oneHome.getByRole('button', { name: 'Create scene' }).click()
  await one.locator('.eui-toolbar').waitFor({ timeout: 120_000 })
  await one.locator('.eui-topbar .eui-autosave', { hasText: 'Synced' }).waitFor()
  await shot('4-synced', first)
  const [sharedId] = await first.evaluate(() => window.__idsOf('Shared scene'))
  const manifestPut = service.log.findIndex((line) => line.startsWith(`PUT /projects/${sharedId}/manifest`))
  assert.ok(manifestPut > 0 && service.log.slice(0, manifestPut).some((line) => line.startsWith('PUT /uploads/')), service.log.join(' | '))
  ok(`signed in, a new scene is copied to the account: ${service.log.filter((line) => line.startsWith('PUT /uploads/')).length} files, then the manifest`)

  await one.locator('.eui-ai-input').fill('Read src/index.ts, prepend exactly "// assistant browser round trip" on its own line, and leave the rest unchanged. Write it and verify with the build tool. Finish by saying exactly: Updated the browser project and verified its build.', { timeout: 30_000 })
  await one.locator('.eui-ai-input').press('Enter')
  await one.locator('.eui-ai-msg.assistant .eui-ai-text').filter({ hasText: 'Updated the browser project and verified its build.' }).waitFor({ timeout: 120_000 })
  const source = await first.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory()
    const dir = await (await (await (await root.getDirectoryHandle('dcl-editor')).getDirectoryHandle('projects')).getDirectoryHandle(id)).getDirectoryHandle('src')
    return (await (await dir.getFileHandle('index.ts')).getFile()).text()
  }, sharedId)
  assert.ok(source.startsWith('// assistant browser round trip\n'), 'the assistant wrote the file in browser storage')
  await one.locator('.eui-topbar .eui-autosave', { hasText: 'Synced' }).waitFor()
  await shot('5-assistant', first)
  ok('assistant: signed connection → WebSocket → browser read/write/build → streamed chat, with no server workspace')

  if (!process.env.ASSISTANT_LIVE_AUTH) {
    const walletMemory = path.join(assistantData, 'memory', WALLET.toLowerCase())
    const memoryFiles = () => fs.existsSync(walletMemory) ? fs.readdirSync(walletMemory).filter((name) => name.endsWith('.bin')) : []
    const answer = 'Updated the browser project and verified its build.'
    const send = async (text) => {
      const replies = one.locator('.eui-ai-msg.assistant .eui-ai-text').filter({ hasText: answer })
      const count = await replies.count()
      await one.locator('.eui-ai-input').fill(text)
      await one.locator('.eui-ai-input').press('Enter')
      await replies.nth(count).waitFor({ timeout: 120_000 })
      await one.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
      await until('the encrypted conversation', () => memoryFiles().length === 1)
    }
    await until('the first encrypted conversation', () => memoryFiles().length === 1)
    const [originalMemory] = memoryFiles()
    assert.ok(!fs.readFileSync(path.join(walletMemory, originalMemory)).includes('assistant browser round trip'), 'the saved conversation contains no plaintext prompt')
    await backToScenes(first)
    await serviceProgram.stop()
    serviceProgram = await startService(new URL(serviceOrigin).port)
    await oneHome.locator('.eui-create-card', { hasText: 'Shared scene' }).click()
    await one.locator('.eui-toolbar').waitFor({ timeout: 120_000 })
    await send('Continue the browser smoke test.')
    assert.equal(restoredConversations.at(-1)?.length, 1, 'the restarted service received the previous turn')
    assert.match(restoredConversations.at(-1)[0], /Read src\/index\.ts, prepend exactly/)
    assert.deepEqual(memoryFiles(), [originalMemory], 'reopening reused the same browser key and conversation')
    await shot('5a-assistant-restored', first)
    ok('assistant memory survives a service restart and reopening the browser project')

    for (const studio of [false, true]) {
      if (studio) await one.getByRole('button', { name: 'Code', exact: true }).click()
      await one.getByRole('button', { name: 'New chat', exact: true }).click()
      await one.locator('.eui-ai-confirm').getByRole('button', { name: 'Yes', exact: true }).click()
      await until('New chat deleting the encrypted conversation', () => memoryFiles().length === 0)
      assert.equal(await first.evaluate(async ({ project, wallet }) => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await root.getDirectoryHandle('dcl-editor')).getDirectoryHandle('assistant')
        return (await Array.fromAsync(dir.keys())).includes(`${project}@${wallet.toLowerCase()}.memory.json`)
      }, { project: sharedId, wallet: WALLET }), false, 'New chat removes the browser key')
      await shot(studio ? '5c-studio-new-chat' : '5b-assistant-new-chat', first)
      await send('Start a new browser smoke conversation.')
      assert.equal(restoredConversations.at(-1), undefined, 'the new chat starts without the forgotten conversation')
      assert.notEqual(memoryFiles()[0], originalMemory, 'the new chat has a different memory ID')
      if (studio) await one.locator('.eui-studio-hbtn').click()
    }
    ok('New chat in the assistant and Script Studio deletes server memory and the browser key, then starts fresh')
  }

  if (assistantOnly) {
    assert.deepEqual(problems, [], 'no page errors, no failed requests')
    return
  }

  const second = await openEditor(await browser.newContext(size), { signedIn: true, openProject: 'no-such-scene' })
  const two = uiOf(second)
  const remote = homeOf(second).locator('.eui-create-card[data-sync="remote"]')
  await remote.getByText('Shared scene').waitFor()
  assert.equal(await remote.getByText('On your account · opening it downloads it').count(), 1)
  await homeOf(second).getByText('“no-such-scene” is not on this device or on your account.', { exact: false }).waitFor()
  await shot('5-second-browser', second)
  await remote.click()
  await second.waitForFunction(() => window.__smoke.spawned === 1, null, { timeout: 120_000 })
  await two.locator('.eui-toolbar').waitFor()
  await two.locator('.eui-topbar .eui-autosave', { hasText: 'Synced' }).waitFor()
  assert.deepEqual(await second.evaluate(() => window.__smoke.openPreview), [`${await second.evaluate((id) => window.__previewId(id), sharedId)}@0,0`])
  const filesOf = (of, id) => of.evaluate((id) => window.__projectFiles(id), id)
  const [there, here] = [await filesOf(first, sharedId), await filesOf(second, sharedId)]
  assert.deepEqual(here, there, 'the second browser has the files of the first')
  assert.ok((await second.evaluate(() => window.__smoke.signed)).every((line) => !line.startsWith('PUT')), 'opening it changed nothing on the account')
  ok(`a second browser lists the scene from the account, downloads its ${Object.keys(here).length} files and opens it; an unknown ?editor=<id> falls back to home with a line`)

  // both browsers change the scene: the second is told, nothing is merged, and
  // "keep both" leaves it with the first one's version and its own as a new scene
  const manifests = (answer) => service.log.filter((line) => line === `PUT /projects/${sharedId}/manifest ${answer}`).length
  const beforeConflict = manifests(200)
  await saveCode(first, '// from the first browser\n')
  await until('the first browser’s change on the account', () => manifests(200) === beforeConflict + 1)
  await saveCode(second, '// from the second browser\n')
  await two.getByText('This scene was changed on another device').waitFor()
  assert.equal(manifests(409), 1, 'the stale manifest was refused')
  assert.notDeepEqual(await filesOf(second, sharedId), await filesOf(first, sharedId))
  await shot('6-conflict', second)
  await two.getByRole('button', { name: 'Keep both', exact: true }).click()
  await two.getByText('This scene was changed on another device').waitFor({ state: 'detached' })
  await two.locator('.eui-topbar .eui-autosave', { hasText: 'Synced' }).waitFor()
  const [copyId] = await second.evaluate(() => window.__idsOf('Shared scene (copy, '))
  assert.match(copyId ?? '', /^shared-scene-copy-/, 'the copy is named for when it was made, not for a device')
  await until('the copy on the account', () => service.log.includes(`PUT /projects/${copyId}/manifest 200`))
  const [theirs, mine, copy] = [await filesOf(first, sharedId), await filesOf(second, sharedId), await filesOf(second, copyId)]
  assert.deepEqual(mine, theirs, 'the scene is now the first browser’s version')
  assert.notEqual(copy['src/index.ts'], theirs['src/index.ts'], 'the copy keeps the second browser’s code')
  assert.equal(manifests(200), beforeConflict + 1, 'the first browser’s version was not overwritten')
  ok('a change on both browsers is a conflict; "Keep both" keeps the other version and saves this one as a new scene')

  // publish to a world: built in the page, confirmed and signed by the host, accepted and served
  await one.locator('.eui-topbar-publish').click()
  await one.locator('.eui-publish-modal').getByText(WORLD).click()
  await shot('7-publish-pick', first)
  await one.locator('.eui-publish-modal').getByRole('button', { name: 'Publish', exact: true }).click()
  await one.getByText(`${WORLD} is live!`).waitFor({ timeout: 120_000 })
  await shot('8-published', first)
  const [entity] = worlds.entities(WORLD)
  const asked = (await first.evaluate(() => window.__smoke.deployments))[0]
  assert.deepEqual([asked.world, asked.entityId, asked.title, asked.fileCount], [WORLD, entity.id, 'Shared scene', entity.content.length], 'the host was asked to sign this deployment')
  assert.ok(asked.bytes > 100_000, `the host was told the size (${asked.bytes} bytes)`)
  assert.equal(entity.metadata.worldConfiguration.name, WORLD)
  const deployed = entity.content.map((item) => item.file).sort()
  assert.ok(deployed.includes('bin/index.js') && deployed.includes('scene.json'), deployed.join(' '))
  assert.ok(!deployed.some((file) => /\.tsx?$|package\.json|lock\.json|tsconfig/.test(file)), `no sources or project files are deployed: ${deployed.join(' ')}`)
  const about = await (await fetch(`${origin}/worlds/world/${WORLD}/about`)).json()
  assert.deepEqual(about.configurations.scenesUrn, [`urn:decentraland:entity:${entity.id}?=&baseUrl=${origin}/worlds/contents/`])
  const served = await fetch(`${origin}/worlds/contents/${entity.content.find((item) => item.file === 'bin/index.js').hash}`)
  assert.ok(served.ok && (await served.arrayBuffer()).byteLength > 100_000, 'the world serves the bundle')
  const realm = encodeURIComponent(`${origin}/worlds/world/${WORLD}`)
  await one.locator('.eui-publish-url', { hasText: `${origin}/?realm=${realm}` }).waitFor()
  assert.equal(await one.locator('.eui-publish-modal').getByRole('button', { name: 'Open it' }).count(), 1)
  await one.locator('.eui-publish-modal .eui-modal-x').click()
  assert.equal(JSON.parse(await first.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    return (await (await (await root.getDirectoryHandle('dcl-editor')).getFileHandle('index.json')).getFile()).text()
  })).projects.find((project) => project.id === sharedId).published.entityId, entity.id, 'the publish is recorded on the project')
  ok(`publish: the host signs ${asked.fileCount} files (${asked.bytes} bytes) as ${entity.id}; the Worlds server accepts it and serves the world's about and files`)

  // a guest is told to sign in, with nothing to press
  await first.evaluate(() => (window.__smoke.guest = true))
  await one.getByText('Guest', { exact: true }).waitFor()
  await one.locator('.eui-ai-chat').waitFor({ state: 'detached', timeout: 10_000 })
  await one.locator('.eui-topbar-publish').click()
  await one.locator('.eui-publish-modal').getByText('Sign in to publish').waitFor()
  await one.getByText('You are in Decentraland as a guest.', { exact: false }).waitFor()
  assert.equal(await one.locator('.eui-publish-modal').getByRole('button', { name: /sign in/i }).count(), 0, 'no sign-in button the editor cannot honour')
  await first.waitForTimeout(400)
  await shot('9-publish-guest', first)
  ok('a guest has no assistant, and one who opens Publish is told to sign in, with no dead button')

  assert.deepEqual(problems, [], 'no page errors, no failed requests')
  ok('no page errors, no failed requests')

  // one byte of the build worker changed on the server: the hash built into editor.js refuses it
  const tampered = await browser.newContext(size)
  const worker = Buffer.from(fs.readFileSync(path.join(dist, 'web-build/worker.js')))
  worker[worker.length - 2] ^= 1
  await tampered.route(`${origin}/editor/web-build/worker.js`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: worker }))
  const altered = await openEditor(tampered)
  await homeOf(altered).getByRole('button', { name: '+ New scene' }).click()
  await homeOf(altered).locator('.eui-home-modal input').fill('Tampered scene')
  await homeOf(altered).getByRole('button', { name: 'Create scene' }).click()
  await uiOf(altered).getByText('web-build/worker.js does not match the hash this editor was published with', { exact: false }).first().waitFor({ timeout: 60_000 })
  assert.deepEqual(await altered.evaluate(() => window.__smoke.openPreview), [], 'nothing built by the altered worker reaches the engine')
  await shot('10-tampered-worker', altered)
  ok('a build worker changed by one byte is refused: the editor says its hash does not match and builds nothing')
}

try {
  if (!assistantOnly) await checkGuestEditor()
  await checkSignedEditor()
  console.log(assistantOnly ? 'assistant smoke: PASS' : 'smoke: PASS')
} catch (error) {
  await shot('failure').catch(() => {})
  console.error(error)
  console.error(`modes/console/bus: ${JSON.stringify(await page.evaluate(() => window.__smoke).catch(() => null))}`)
  console.error(`problems: ${JSON.stringify(problems)}`)
  console.error(`service: ${JSON.stringify(service.log.slice(-12))}`)
  console.error(`worlds: ${JSON.stringify(worlds.log.slice(-12))} registry: ${JSON.stringify(registryRequests)}`)
  for (const [n, other] of browser.contexts().flatMap((c) => c.pages()).entries()) {
    console.error(`page ${n}: ${JSON.stringify(await other.evaluate(() => ({ signed: window.__smoke.signed, text: document.querySelector('#create-body #editor-ui-host')?.shadowRoot?.querySelector('.eui-create')?.textContent?.slice(0, 400) })).catch(() => null))}`)
    await shot(`failure-${n}`, other).catch(() => {})
  }
  console.log('smoke: FAIL')
  process.exitCode = 1
} finally {
  await browser.close()
  await serviceProgram.stop()
  fs.rmSync(assistantData, { recursive: true, force: true })
  server.close()
}
