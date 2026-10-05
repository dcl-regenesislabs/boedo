// Builds dist/: index.js (page library), worker.js, esbuild.wasm, sdk-snapshot.json.
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSnapshot, locatePinnedSdk } from './make-sdk-snapshot.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const require = createRequire(import.meta.url)
const sdk = locatePinnedSdk()

const wasmPackage = path.dirname(require.resolve('esbuild-wasm/package.json'))
const wasmVersion = JSON.parse(fs.readFileSync(path.join(wasmPackage, 'package.json'), 'utf8')).version
if (wasmVersion !== sdk.esbuildVersion) {
  throw new Error(`esbuild-wasm ${wasmVersion} must match the esbuild ${sdk.esbuildVersion} that @dcl/sdk-commands ${sdk.version} bundles with`)
}

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

const common = { bundle: true, platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning' }
await esbuild.build({ ...common, entryPoints: [path.join(root, 'src/index.ts')], format: 'esm', outfile: path.join(dist, 'index.js') })
await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/worker.ts')],
  format: 'iife',
  outfile: path.join(dist, 'worker.js'),
  // the composite tooling sdk-commands itself calls
  alias: {
    '@pinned-sdk/ecs': path.join(sdk.ecsDir, 'dist-cjs/index.js'),
    '@pinned-sdk/inspector': path.join(sdk.inspectorDir, 'dist/tooling-entrypoint.js')
  },
  define: { 'process.env.NODE_ENV': '"production"' }
})
fs.copyFileSync(path.join(wasmPackage, 'esbuild.wasm'), path.join(dist, 'esbuild.wasm'))
const { snapshot } = await buildSnapshot()
fs.writeFileSync(path.join(dist, 'sdk-snapshot.json'), JSON.stringify(snapshot))

for (const name of fs.readdirSync(dist).sort()) {
  const bytes = fs.readFileSync(path.join(dist, name))
  console.log(`${name.padEnd(18)} ${String(bytes.length).padStart(9)} bytes  ${String(zlib.gzipSync(bytes).length).padStart(8)} gzip`)
}
