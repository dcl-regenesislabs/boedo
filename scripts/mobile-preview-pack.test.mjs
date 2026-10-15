import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const directories = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'preview-pack-'))
  directories.push(dir)
  await mkdir(path.join(dir, 'scripts'))
  await mkdir(path.join(dir, 'dist'))
  await copyFile(new URL('../packages/mobile-preview/scripts/check-dist.mjs', import.meta.url), path.join(dir, 'scripts/check-dist.mjs'))
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.0' }))
  const files = {}
  for (const name of ['index.html', 'index.js', 'index.wasm', 'index.side.wasm', 'index.pck', 'dclgodot.wasm', 'bridge.js', 'realm-fetch.js', 'capture.js']) {
    await writeFile(path.join(dir, 'dist', name), 'fixture')
    files[name] = { bytes: 7, sha256: createHash('sha256').update('fixture').digest('hex') }
  }
  const manifest = { version: '0.1.0', files }
  const save = () => writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest))
  await save()
  return { dir, manifest, save, check: () => execFileSync(process.execPath, [path.join(dir, 'scripts/check-dist.mjs')], { stdio: 'pipe' }) }
}

it('checks every packaged artifact and rejects files npm would include outside the manifest', async () => {
  const { dir, check } = await fixture()
  expect(check).not.toThrow()
  await writeFile(path.join(dir, 'dist', 'private.txt'), 'not a runtime artifact')
  expect(check).toThrow(/Unlisted runtime artifact/)
})

it('rejects incomplete manifests, path escapes and modified artifacts', async () => {
  const { dir, manifest, save, check } = await fixture()
  const original = { ...manifest.files }
  manifest.files = {}
  await save()
  expect(check).toThrow(/Missing runtime artifact/)
  manifest.files = { ...original, '../private.txt': original['index.js'] }
  await save()
  expect(check).toThrow(/Unexpected runtime artifact/)
  manifest.files = original
  await save()
  await writeFile(path.join(dir, 'dist/index.js'), 'changed')
  expect(check).toThrow(/Runtime artifact changed/)
})
