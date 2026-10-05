// Writes dist/sdk-snapshot.json: the pinned @dcl/sdk and every package its
// files import, plus sdk-commands' entry-point and script-module templates.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import zlib from 'node:zlib'
import Module, { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(here, '../../..')
const TEMPLATE_DIR = path.join(REPO_ROOT, 'packages/desktop/templates/starter')

// stand-ins the browser build swaps for the scene's own values
const PLACEHOLDERS = {
  entrypoint: '/__SCENE_ENTRYPOINT__',
  scriptImports: '/*__SCRIPT_IMPORTS__*/',
  scriptsArray: '/*__SCRIPTS_ARRAY__*/'
}

// never part of a scene bundle
const EXCLUDED = new Set(['@dcl/sdk-commands', '@dcl/explorer', '@dcl/inspector'])
const RUNTIME_FILE = /\.(js|mjs|cjs|json)$/
// build artifacts and test suites no scene import reaches
const PRUNED_TOP_DIRS = {
  protobufjs: ['dist', 'cli', 'scripts', 'ext', 'google'],
  react: ['umd'],
  scheduler: ['umd']
}
const PRUNED_DIRS = new Set(['node_modules', 'tests', 'test', '__tests__', 'bench'])
const SPECIFIER =
  /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)|\b(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(?\s*['"]([^'"\n]+)['"]/g

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

// The templates pin the scene SDK; npm may install it under an alias directory.
export function locatePinnedSdk(repoRoot = REPO_ROOT) {
  const pinned = readJson(path.join(TEMPLATE_DIR, 'package.json')).devDependencies['@dcl/sdk']
  const scope = path.join(repoRoot, 'node_modules/@dcl')
  const sdkDir = fs
    .readdirSync(scope)
    .map((name) => path.join(scope, name))
    .find((dir) => {
      const file = path.join(dir, 'package.json')
      if (!fs.existsSync(file)) return false
      const pkg = readJson(file)
      return pkg.name === '@dcl/sdk' && pkg.version === pinned
    })
  if (sdkDir === undefined) throw new Error(`@dcl/sdk@${pinned} (pinned by templates/starter) is not installed`)
  const fromSdk = createRequire(path.join(sdkDir, 'package.json'))
  const sdkCommandsDir = path.dirname(fromSdk.resolve('@dcl/sdk-commands/package.json'))
  const fromCommands = createRequire(path.join(sdkCommandsDir, 'package.json'))
  const inspectorDir = path.dirname(fromCommands.resolve('@dcl/inspector/package.json'))
  return {
    version: pinned,
    sdkDir: fs.realpathSync(sdkDir),
    sdkCommandsDir: fs.realpathSync(sdkCommandsDir),
    inspectorDir: fs.realpathSync(inspectorDir),
    ecsDir: fs.realpathSync(path.dirname(fromSdk.resolve('@dcl/ecs/package.json'))),
    reactFile: fs.realpathSync(fromSdk.resolve('react')),
    esbuildVersion: readJson(fromCommands.resolve('esbuild/package.json')).version,
    inspectorVersion: readJson(path.join(inspectorDir, 'package.json')).version
  }
}

const packageNameOf = (specifier) => specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

function findPackageDir(name, fromFile) {
  for (const dir of createRequire(fromFile).resolve.paths(name) ?? []) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
  }
  return null
}

function runtimeFiles(packageDir, pruned) {
  const out = []
  const walk = (dir, top) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!PRUNED_DIRS.has(entry.name) && !(top && pruned.includes(entry.name))) walk(full, false)
      } else if (RUNTIME_FILE.test(entry.name) && !(top && entry.name === 'tsconfig.json')) out.push(full)
    }
  }
  walk(packageDir, true)
  return out
}

// Splits an installed file into its package directories, outermost first, and its posix path inside the last one.
export function installChain(realFile, p = path) {
  const marker = `${p.sep}node_modules${p.sep}`
  const parts = realFile.split(marker)
  let dir = parts[0]
  const dirs = []
  for (const part of parts.slice(1, -1)) {
    dir += marker + part
    dirs.push(dir)
  }
  const last = parts[parts.length - 1].split(p.sep)
  const depth = last[0].startsWith('@') ? 2 : 1
  dirs.push(dir + marker + last.slice(0, depth).join(p.sep))
  return { dirs, inner: last.slice(depth).join('/') }
}

// Keeps the installed nesting, naming each directory after its package.json name.
function virtualPath(realFile) {
  const { dirs, inner } = installChain(realFile)
  const names = dirs.map((dir) => 'node_modules/' + readJson(path.join(dir, 'package.json')).name)
  return [...names, inner].join('/')
}

// sdk-commands keeps these generators private: run its module with them exposed.
async function readToolchain(sdkCommandsDir) {
  const file = path.join(sdkCommandsDir, 'dist/logic/bundle.js')
  const source = fs.readFileSync(file, 'utf8') + '\nmodule.exports.__private = { getEntrypointCode, prepareRuntimeCode, generateVirtualModuleContent }'
  const mod = { exports: {} }
  vm.runInThisContext(Module.wrap(source), { filename: file })(
    mod.exports,
    createRequire(file),
    mod,
    file,
    path.dirname(file)
  )
  const { getEntrypointCode, prepareRuntimeCode, generateVirtualModuleContent } = mod.exports.__private
  const runtime = await prepareRuntimeCode({ readFile: (p, encoding) => fs.promises.readFile(p, encoding) })
  return {
    placeholders: PLACEHOLDERS,
    entrypoint: {
      scene: getEntrypointCode(PLACEHOLDERS.entrypoint, false, false),
      editorScene: getEntrypointCode(PLACEHOLDERS.entrypoint, false, true)
    },
    scriptUtils: generateVirtualModuleContent(PLACEHOLDERS.scriptImports, runtime, PLACEHOLDERS.scriptsArray)
  }
}

export async function buildSnapshot(repoRoot = REPO_ROOT) {
  const sdk = locatePinnedSdk(repoRoot)
  const packages = new Map()
  const unresolved = new Set()
  const files = {}
  // the build aliases these two, so every importer gets the pinned copy
  const aliased = { '@dcl/sdk': sdk.sdkDir, '@dcl/ecs': sdk.ecsDir }
  const add = (virtual, text) => {
    if (files[virtual] !== undefined && files[virtual] !== text) throw new Error(`two installs map to ${virtual}`)
    files[virtual] = text
  }

  const visit = (packageDir) => {
    if (packages.has(packageDir)) return
    const pkg = readJson(path.join(packageDir, 'package.json'))
    const list = runtimeFiles(packageDir, PRUNED_TOP_DIRS[pkg.name] ?? [])
    packages.set(packageDir, { name: pkg.name, version: pkg.version, files: list.length, bytes: 0 })
    const wanted = new Map(Object.keys(pkg.dependencies ?? {}).map((dep) => [dep, path.join(packageDir, 'package.json')]))
    for (const file of list) {
      const text = fs.readFileSync(file, 'utf8')
      add(virtualPath(file), text)
      packages.get(packageDir).bytes += Buffer.byteLength(text)
      if (file.endsWith('.json')) continue
      for (const match of text.matchAll(SPECIFIER)) {
        const specifier = match[1] ?? match[2] ?? match[3]
        if (/^[./~]|^node:/.test(specifier) || builtinModules.includes(specifier)) continue
        if (!wanted.has(packageNameOf(specifier))) wanted.set(packageNameOf(specifier), file)
      }
    }
    for (const [name, fromFile] of wanted) {
      if (EXCLUDED.has(name) || name.startsWith('@types/') || name === pkg.name) continue
      const dir = aliased[name] ?? findPackageDir(name, fromFile)
      if (dir === null) unresolved.add(name)
      else visit(dir)
    }
  }
  visit(sdk.sdkDir)

  // every bundle requires @dcl/asset-packs; this no-op covers projects without one
  const stubDir = path.join(TEMPLATE_DIR, 'vendor/asset-packs-stub')
  for (const file of runtimeFiles(stubDir, [])) {
    add('node_modules/@dcl/asset-packs/' + path.relative(stubDir, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8'))
  }

  // top-level packages and the SDK's own are what a scene import can reach; the tools are never bundled
  const provided = {}
  const fromCommands = createRequire(path.join(sdk.sdkCommandsDir, 'package.json'))
  for (const name of EXCLUDED) {
    let version = ''
    try {
      version = readJson(fromCommands.resolve(name + '/package.json')).version
    } catch {
      // not installed: still never fetched
    }
    provided[name] = { version, dir: null }
  }
  for (const [packageDir, { name, version }] of packages) {
    const dir = virtualPath(path.join(packageDir, 'package.json')).slice(0, -'/package.json'.length)
    if (dir === 'node_modules/' + name || version === sdk.version) provided[name] = { version, dir }
  }

  const meta = {
    sdkVersion: sdk.version,
    sdkCommandsVersion: readJson(path.join(sdk.sdkCommandsDir, 'package.json')).version,
    inspectorVersion: sdk.inspectorVersion,
    esbuildVersion: sdk.esbuildVersion,
    aliases: {
      react: virtualPath(sdk.reactFile),
      '@dcl/sdk': virtualPath(path.join(sdk.sdkDir, 'package.json')).slice(0, -'/package.json'.length),
      '@dcl/ecs': virtualPath(path.join(sdk.ecsDir, 'package.json')).slice(0, -'/package.json'.length),
      '@dcl/asset-packs': 'node_modules/@dcl/asset-packs'
    },
    provided,
    ...(await readToolchain(sdk.sdkCommandsDir))
  }
  return { snapshot: { meta, files }, packages: [...packages.values()], unresolved: [...unresolved].sort() }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { snapshot, packages, unresolved } = await buildSnapshot()
  const out = path.resolve(here, '../dist/sdk-snapshot.json')
  const json = JSON.stringify(snapshot)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, json)
  for (const p of packages) console.log(`${(p.bytes / 1024).toFixed(0).padStart(6)} KB ${String(p.files).padStart(4)} files  ${p.name}@${p.version}`)
  if (unresolved.length > 0) console.log(`not installed, skipped: ${unresolved.join(', ')}`)
  console.log(
    `sdk-snapshot.json: @dcl/sdk ${snapshot.meta.sdkVersion}, ${Object.keys(snapshot.files).length} files, ` +
      `${Buffer.byteLength(json)} bytes raw, ${zlib.gzipSync(json).length} bytes gzip`
  )
}
