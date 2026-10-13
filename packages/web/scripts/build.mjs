// Builds dist/: editor.js (+ editor.css, chunks/, assets/), web-build/ copied
// from @dcl-editor/web-build, and prefabs/ from the desktop app's built-ins.
// dist/scene/ belongs to the editor scene's static export and is left alone.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { build as bundle } from 'esbuild'
import { build } from 'vite'
import { sri, writePrefabCatalog } from './prefab-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '../..')
const dist = path.join(root, 'dist')
const webBuildDist = path.join(repo, 'packages/web-build/dist')
const WEB_BUILD_FILES = ['index.js', 'worker.js', 'esbuild.wasm', 'sdk-snapshot.json']

// Windows: npm is npm.cmd, which Node only executes through a shell
const webBuild = spawnSync('npm', ['run', 'build', '-w', '@dcl-editor/web-build'], {
  cwd: repo,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (webBuild.status !== 0) process.exit(webBuild.status ?? 1)

fs.mkdirSync(dist, { recursive: true })
for (const entry of fs.readdirSync(dist)) {
  if (entry !== 'scene') fs.rmSync(path.join(dist, entry), { recursive: true, force: true })
}

// Every file editor.js fetches is pinned by a sha384 written into editor.js, so
// the one integrity a host checks on editor.js covers them all (workers.ts).
const SENTINEL = '"@@EDITOR_FILE_INTEGRITY@@"'
const integrity = {}
for (const file of ['worker.js', 'esbuild.wasm', 'sdk-snapshot.json']) {
  integrity[`web-build/${file}`] = sri(fs.readFileSync(path.join(webBuildDist, file)))
}

// three.js lives only in this worker, fetched the first time a model is built or previewed
await bundle({
  entryPoints: [path.join(repo, 'packages/ui/src/three/worker.ts')],
  outfile: path.join(dist, 'three/worker.js'),
  bundle: true, minify: true, format: 'iife', target: 'es2022', legalComments: 'none', logLevel: 'warning'
})
integrity['three/worker.js'] = sri(fs.readFileSync(path.join(dist, 'three/worker.js')))

const catalog = writePrefabCatalog(path.join(repo, 'packages/desktop/prefabs'), dist)
integrity[catalog.file] = catalog.integrity

// the shared materials buildModel writes into a project, fetched only when a model uses one
const materials = path.join(repo, 'packages/ui/src/three/materials')
for (const name of fs.readdirSync(materials, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  for (const file of fs.readdirSync(path.join(materials, name)).filter((f) => f.endsWith('.jpg'))) {
    const rel = `materials/${name}/${file}`
    fs.mkdirSync(path.join(dist, 'materials', name), { recursive: true })
    fs.copyFileSync(path.join(materials, name, file), path.join(dist, rel))
    integrity[rel] = sri(fs.readFileSync(path.join(dist, rel)))
  }
}

const pinFetchedFiles = {
  name: 'pin-fetched-files',
  enforce: 'post',
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk' && output.fileName !== 'editor.js') this.error(`${output.fileName}: a separate chunk could not be pinned`)
      if (output.type === 'asset' && output.fileName !== 'editor.css') this.error(`${output.fileName}: a separate asset could not be pinned`)
      if (output.type === 'asset') integrity[output.fileName] = sri(output.source)
    }
    const entry = bundle['editor.js']
    if (entry?.type !== 'chunk' || entry.code.split(SENTINEL).length !== 2) this.error('editor.js must hold the file hashes placeholder exactly once')
    entry.code = entry.code.replace(SENTINEL, JSON.stringify(integrity))
  }
}
await build({
  configFile: path.join(root, 'vite.config.ts'),
  logLevel: 'warn',
  plugins: [pinFetchedFiles],
  define: { __EDITOR_FILE_INTEGRITY__: SENTINEL }
})

fs.mkdirSync(path.join(dist, 'web-build'), { recursive: true })
for (const file of WEB_BUILD_FILES) fs.copyFileSync(path.join(webBuildDist, file), path.join(dist, 'web-build', file))
for (const [file, expected] of Object.entries(integrity)) {
  if (sri(fs.readFileSync(path.join(dist, file))) !== expected) throw new Error(`dist/${file} does not match the hash written into editor.js`)
}
fs.mkdirSync(path.join(dist, 'scene'), { recursive: true })

function list(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? list(full) : [full]
  })
}
const sizes = new Map()
for (const file of list(dist).sort()) {
  const bytes = fs.readFileSync(file)
  const name = path.relative(dist, file).split(path.sep).join('/')
  // one line for the prefabs: they are hundreds of small files
  const key = name.startsWith('prefabs/') ? 'prefabs/' : name
  const [raw, gzip] = sizes.get(key) ?? [0, 0]
  sizes.set(key, [raw + bytes.length, gzip + zlib.gzipSync(bytes).length])
}
for (const [name, [raw, gzip]] of sizes) {
  console.log(`${name.padEnd(44)} ${String(raw).padStart(9)} bytes  ${String(gzip).padStart(8)} gzip`)
}

// dist/scene is only re-exported on request, so a hosted editor keeps running the
// old editor scene (gizmo, selection, play behaviour) after a scene change
function newest(dir) {
  if (!fs.existsSync(dir)) return 0
  return Math.max(0, ...list(dir).map((file) => fs.statSync(file).mtimeMs))
}
const sceneExport = path.join(dist, 'scene')
if (fs.readdirSync(sceneExport).length > 0 && newest(path.join(repo, 'packages/scene/src')) > newest(sceneExport)) {
  console.warn('⚠ dist/scene is older than packages/scene/src: run `npm run export-static -w @dcl-editor/scene`')
}
