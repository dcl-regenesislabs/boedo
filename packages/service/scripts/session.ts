// A scripted client against a running service: one wallet on two devices, and a stranger.
//   node packages/service/scripts/session.ts --url http://localhost:8787 --origin http://localhost:5230
import { parseArgs } from 'node:util'
import { Authenticator } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto.js'
import { contentCid } from '../../contract/src/cid.ts'
import { createTestWallet } from '../src/testing/wallet.ts'
import type { TestWallet } from '../src/testing/wallet.ts'

const { values } = parseArgs({
  options: { url: { type: 'string', default: 'http://localhost:8787' }, origin: { type: 'string', default: 'http://localhost:5230' } }
})
const base = values.url.replace(/\/$/, '')
const project = `session-${Date.now().toString(36)}`

function check(condition: boolean, what: string): void {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${what}`)
  if (!condition) process.exitCode = 1
}

type Files = Record<string, Uint8Array<ArrayBuffer>>

async function describe(files: Files) {
  const out: Record<string, { hash: string; size: number }> = {}
  for (const [file, bytes] of Object.entries(files)) out[file] = { hash: await contentCid(bytes), size: bytes.length }
  return out
}

async function save(wallet: TestWallet, files: Files, baseVersion: number | null): Promise<Response> {
  const described = await describe(files)
  const asked = await wallet.signedFetch(`${base}/projects/${project}/uploads`, {
    method: 'POST',
    body: JSON.stringify({ files: Object.values(described) })
  })
  const { uploads } = (await asked.json()) as { uploads: Array<{ hash: string; url: string; method: string; headers: Record<string, string> }> }
  console.log(`    POST uploads -> ${asked.status}, ${uploads.length} to upload`)
  for (const target of uploads) {
    const [file] = Object.entries(described).find(([, entry]) => entry.hash === target.hash) ?? []
    const put = await fetch(target.url, { method: target.method, headers: { ...target.headers, origin: wallet.origin }, body: files[file ?? ''] })
    console.log(`    PUT ${target.hash} (${file}, ${files[file ?? ''].length} bytes) -> ${put.status}`)
  }
  return wallet.signedFetch(`${base}/projects/${project}/manifest`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Session scene', files: described, baseVersion })
  })
}

const laptop = await createTestWallet({ origin: values.origin })
console.log(`wallet ${laptop.address}, project ${project}, service ${base}`)

const files: Files = {
  'src/index.ts': new TextEncoder().encode('export function main() {}\n'),
  'assets/big.bin': Uint8Array.from({ length: 400_000 }, (_, i) => (i * 7) % 251)
}
const first = await save(laptop, files, null)
const firstBody = (await first.json()) as { version: number }
check(first.status === 200 && firstBody.version === 1, `first save -> ${first.status} ${JSON.stringify(firstBody)}`)

const desktop = await laptop.anotherDevice()
const listed = await desktop.signedFetch(`${base}/projects`)
const listedBody = (await listed.json()) as { projects: Array<{ id: string; version: number; bytes: number }> }
const mine = listedBody.projects.find((entry) => entry.id === project)
check(listed.status === 200 && mine?.version === 1, `second device lists the project -> ${JSON.stringify(mine)}`)

const manifest = (await (await desktop.signedFetch(`${base}/projects/${project}/manifest`)).json()) as {
  version: number
  files: Record<string, { hash: string; size: number }>
}
for (const [file, entry] of Object.entries(manifest.files)) {
  const blob = await desktop.signedFetch(`${base}/projects/${project}/files/${entry.hash}`)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const same = bytes.length === entry.size && (await contentCid(bytes)) === entry.hash
  check(blob.status === 200 && same, `second device reads ${file} (${entry.hash}, ${bytes.length} bytes, ${blob.headers.get('content-type')})`)
}

const edited = { ...files, 'src/index.ts': new TextEncoder().encode('export function main() { console.log(1) }\n') }
const second = await save(desktop, edited, manifest.version)
check(second.status === 200, `second device saves on version 1 -> ${second.status} ${JSON.stringify(await second.json())}`)

const stale = await save(laptop, { ...files, 'README.md': new TextEncoder().encode('late\n') }, 1)
check(stale.status === 409, `first device saves on stale version 1 -> ${stale.status} ${JSON.stringify(await stale.json())}`)

const stranger = await createTestWallet({ origin: values.origin })
const peek = await stranger.signedFetch(`${base}/projects/${project}/manifest`)
check(peek.status === 404, `another wallet reads the manifest -> ${peek.status}`)
const steal = await stranger.signedFetch(`${base}/projects/copy/manifest`, {
  method: 'PUT',
  body: JSON.stringify({ name: 'Copy', files: manifest.files, baseVersion: null })
})
check(steal.status === 422, `another wallet references those blobs -> ${steal.status}`)

const unsigned = await fetch(`${base}/projects`, { headers: { origin: values.origin } })
check(unsigned.status === 401, `unsigned request -> ${unsigned.status}`)

// two devices save on the same version at once: the store's conditional write lets one through
const latest = (await (await laptop.signedFetch(`${base}/projects/${project}/manifest`)).json()) as typeof manifest
const racing = await Promise.all(
  [laptop, desktop].map((device, i) =>
    device.signedFetch(`${base}/projects/${project}/manifest`, {
      method: 'PUT',
      body: JSON.stringify({ name: `Race ${i}`, files: latest.files, baseVersion: latest.version })
    })
  )
)
const raced = racing.map((response) => response.status).sort()
check(raced[0] === 200 && raced[1] === 409, `two saves on version ${latest.version} at once -> ${raced.join(', ')}`)

const fresh = { 'ticket.bin': Uint8Array.from({ length: 1000 }, (_, i) => (i * 13) % 251) }
const freshDescribed = await describe(fresh)
const asked = await laptop.signedFetch(`${base}/projects/${project}/uploads`, {
  method: 'POST',
  body: JSON.stringify({ files: Object.values(freshDescribed) })
})
const [ticketed] = ((await asked.json()) as { uploads: Array<{ url: string }> }).uploads
const put = (url: string, body: Uint8Array<ArrayBuffer>) => fetch(url, { method: 'PUT', headers: { origin: values.origin }, body })
const forged = await put(ticketed.url.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0')), fresh['ticket.bin'])
check(forged.status === 403, `upload with a forged ticket -> ${forged.status} ${JSON.stringify(await forged.json())}`)
const used = await put(ticketed.url, fresh['ticket.bin'])
check(used.status === 201, `upload with its ticket -> ${used.status}`)
const reused = await put(ticketed.url, fresh['ticket.bin'])
check(reused.status === 403, `the same ticket again -> ${reused.status} ${JSON.stringify(await reused.json())}`)

// one personal_sign of a bare address must not delegate the wallet
const owner = createUnsafeIdentity()
const attacker = createUnsafeIdentity()
const metadata = JSON.stringify({ intent: 'dcl:editor:projects', signer: 'dcl:editor', origin: values.origin })
const timestamp = String(Date.now())
const { pathname, search } = new URL(`${base}/projects`)
const payload = ['get', `${pathname}${search}`, timestamp, metadata].join(':').toLowerCase()
const delegate = attacker.address.toLowerCase()
const chain = [
  { type: 'SIGNER', payload: owner.address, signature: '' },
  { type: 'ECDSA_SIGNED_ENTITY', payload: delegate, signature: Authenticator.createSignature(owner, delegate) },
  { type: 'ECDSA_SIGNED_ENTITY', payload, signature: Authenticator.createSignature(attacker, payload) }
]
const headers: Record<string, string> = { origin: values.origin, 'x-identity-timestamp': timestamp, 'x-identity-metadata': metadata }
chain.forEach((link, index) => (headers[`x-identity-auth-chain-${index}`] = JSON.stringify(link)))
const bare = await fetch(`${base}/projects`, { headers })
check(bare.status === 401, `a bare-address delegation -> ${bare.status} ${JSON.stringify(await bare.json())}`)
