import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rawCid } from '../../contract/src/cid.ts'
import { createRateLimiter, createUploadGate } from './config.ts'
import type { Env, Limits } from './config.ts'
import { createFsStore } from './fs-store.ts'
import { handle } from './handler.ts'
import { keys } from './paths.ts'
import { purge } from './purge.ts'
import { createQuotaStore, StorageFull } from './quota-store.ts'
import { createLock, createMemoryStore } from './store.ts'
import type { BlobStore } from './store.ts'
import { createTestWallet } from './testing/wallet.ts'
import worker from './worker.ts'

const BASE = 'http://storage.test'
const ORIGIN = 'http://editor.test'
const DAY = 86400000
const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function setup(filesystem: boolean, limits: Partial<Limits> = {}) {
  let now = Date.now()
  const clock = { now: () => now }
  let store: BlobStore = createMemoryStore(clock)
  if (filesystem) {
    const directory = await mkdtemp(path.join(tmpdir(), 'dcl-storage-security-'))
    directories.push(directory)
    store = createFsStore(directory)
  }
  const env: Env = { store, clock, limits, allowedOrigins: [ORIGIN],
    ticketSecret: 'synthetic-security-test-secret-only', rateLimiter: createRateLimiter(),
    uploads: createUploadGate(), lock: createLock() }
  const send = (request: Request) => handle(request, env)
  const wallet = await createTestWallet({ origin: ORIGIN, fetch: send, now: clock.now, validMinutes: 30 * 24 * 60 })
  const upload = async (bytes: Uint8Array<ArrayBuffer>, owner = wallet) => {
    const file = { hash: await rawCid(bytes), size: bytes.length }
    const response = await owner.signedFetch(BASE + '/projects/test/uploads', { method: 'POST', body: JSON.stringify({ files: [file] }) })
    expect(response.status).toBe(200)
    const { uploads } = await response.json() as { uploads: Array<{ url: string }> }
    for (const target of uploads) expect((await send(new Request(target.url, { method: 'PUT', body: bytes }))).status).toBe(201)
    return file
  }
  return { env, store, send, wallet, upload, advance(ms: number) { now += ms } }
}

describe.each([false, true])('storage security (filesystem=%s)', (filesystem) => {
  it('reclaims physical blobs along with wallet quota', async () => {
    const ctx = await setup(filesystem, { maxWalletBytes: 16 })
    const first = await ctx.upload(new Uint8Array(16).fill(1))
    ctx.advance(DAY + 1000)
    await purge(ctx.env)
    expect(await ctx.store.head(keys.blob(first.hash))).toBeNull()
    await ctx.upload(new Uint8Array(16).fill(2))
    const objects = await Promise.all((await ctx.store.list('blobs/')).map((key) => ctx.store.head(key)))
    expect(objects.reduce((sum, info) => sum + (info?.size ?? 0), 0)).toBe(16)
  })

  it('preserves blobs referenced by another wallet and by retained history', async () => {
    const ctx = await setup(filesystem)
    const second = await createTestWallet({ origin: ORIGIN, fetch: ctx.send })
    const bytes = new Uint8Array([1, 2, 3])
    const file = await ctx.upload(bytes)
    await ctx.upload(bytes, second)
    const save = (files: unknown, version: number | null) => second.signedFetch(BASE + '/projects/kept/manifest', {
      method: 'PUT', body: JSON.stringify({ name: 'Kept', files, baseVersion: version }) })
    expect((await save({ 'a.ts': file }, null)).status).toBe(200)
    expect((await save({}, 1)).status).toBe(200)
    ctx.advance(DAY + 1000)
    await purge(ctx.env)
    expect(await ctx.store.head(keys.marker(ctx.wallet.address, file.hash, file.size))).toBeNull()
    expect(await ctx.store.head(keys.marker(second.address, file.hash, file.size))).not.toBeNull()
    expect(await ctx.store.head(keys.blob(file.hash))).not.toBeNull()
  })

  it('serializes the wallet project limit across different project ids', async () => {
    const { wallet } = await setup(filesystem, { maxProjects: 1 })
    const responses = await Promise.all(['first', 'second'].map((id) => wallet.signedFetch(BASE + '/projects/' + id + '/manifest', {
      method: 'PUT', body: JSON.stringify({ name: id, files: {}, baseVersion: null }) })))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 413])
  })

  it('caps spent tickets even when every upload fails hash validation', async () => {
    const ctx = await setup(filesystem, { maxSpentTickets: 2 })
    const files = await Promise.all([1, 2, 3].map(async (value) => ({ hash: await rawCid(new Uint8Array([value])), size: 0 })))
    const response = await ctx.wallet.signedFetch(BASE + '/projects/test/uploads', { method: 'POST', body: JSON.stringify({ files }) })
    const { uploads } = await response.json() as { uploads: Array<{ url: string }> }
    const statuses: number[] = []
    for (const { url } of uploads) statuses.push((await ctx.send(new Request(url, { method: 'PUT', body: new Uint8Array(0) }))).status)
    expect(statuses).toEqual([422, 422, 503])
    expect(await ctx.store.list(keys.tickets)).toHaveLength(2)
    ctx.advance(16 * 60_000)
    await purge(ctx.env)
    expect(await ctx.store.list(keys.tickets)).toHaveLength(0)
  })

  it("keeps one wallet's spent tickets from blocking another wallet's uploads", async () => {
    const ctx = await setup(filesystem, { maxSpentTickets: 4, maxSpentTicketsPerWallet: 2 })
    const files = await Promise.all([1, 2, 3, 4].map(async (value) => ({ hash: await rawCid(new Uint8Array([value])), size: 0 })))
    const response = await ctx.wallet.signedFetch(BASE + '/projects/test/uploads', { method: 'POST', body: JSON.stringify({ files }) })
    const { uploads } = await response.json() as { uploads: Array<{ url: string }> }
    const statuses: number[] = []
    for (const { url } of uploads) statuses.push((await ctx.send(new Request(url, { method: 'PUT', body: new Uint8Array(0) }))).status)
    expect(statuses).toEqual([422, 422, 429, 429])
    await ctx.upload(new Uint8Array([9]), await createTestWallet({ origin: ORIGIN, fetch: ctx.send }))
  })
})

it('keeps a purge sweep pending while expired tickets remain', async () => {
  const ctx = await setup(false)
  for (let i = 0; i < 501; i++) await ctx.store.put(keys.ticket(1, ctx.wallet.address, i.toString(16)), new Uint8Array(0))
  expect(await purge(ctx.env)).toMatchObject({ tickets: 500, done: false })
  expect(await purge(ctx.env)).toMatchObject({ tickets: 1, done: true })
  expect(await ctx.store.list(keys.tickets)).toHaveLength(0)
})

it('enforces global byte and object budgets across wallets and restarts', async () => {
  const base = createMemoryStore()
  const limits = { maxStorageBytes: 16, maxStorageObjects: 2 }
  let store = await createQuotaStore(base, limits)
  const writes = await Promise.allSettled([
    store.put('blobs/first', new Uint8Array(16)), store.put('blobs/second', new Uint8Array(16))
  ])
  expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  store = await createQuotaStore(base, limits)
  await expect(store.put('blobs/third', new Uint8Array(1))).rejects.toBeInstanceOf(StorageFull)
  await store.put('uploads/tickets/first', new Uint8Array(0))
  await expect(store.put('uploads/tickets/second', new Uint8Array(0))).rejects.toBeInstanceOf(StorageFull)
  await store.delete('blobs/first')
  await expect(store.put('blobs/third', new Uint8Array(16))).resolves.not.toBeNull()
})

it('refuses storage access from wallets outside the configured list', async () => {
  const ctx = await setup(false)
  ctx.env.storageWallets = new Set()
  expect((await ctx.wallet.signedFetch(BASE + '/projects')).status).toBe(403)
})

it("charges manifests and their history to the wallet, so one wallet's saves cannot fill the service", async () => {
  const ctx = await setup(false, { maxWalletBytes: 20_000 })
  const blob = await ctx.upload(new Uint8Array([7]))
  ctx.env.store = await createQuotaStore(ctx.store, { maxStorageBytes: 30_000, maxStorageObjects: 1000 })
  const files = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`src/${'a'.repeat(60)}${i}.ts`, blob]))
  let version: number | null = null
  let refused: Response | undefined
  for (let i = 0; i < 30 && refused === undefined; i++) {
    const response = await ctx.wallet.signedFetch(BASE + '/projects/big/manifest', {
      method: 'PUT', body: JSON.stringify({ name: 'Big', files, baseVersion: version }) })
    if (response.status === 200) version = (await response.json() as { version: number }).version
    else refused = response
  }
  expect([refused?.status, (await refused?.json() as { error?: string } | undefined)?.error]).toEqual([413, 'quota-exceeded'])
  const other = await createTestWallet({ origin: ORIGIN, fetch: ctx.send })
  const small = await ctx.upload(new Uint8Array([8]), other)
  const saved = await other.signedFetch(BASE + '/projects/mine/manifest', {
    method: 'PUT', body: JSON.stringify({ name: 'Mine', files: { 'a.ts': small }, baseVersion: null }) })
  expect(saved.status).toBe(200)
})

it('still allows a project to enter the trash when the service byte budget is full', async () => {
  const ctx = await setup(false)
  const response = await ctx.wallet.signedFetch(BASE + '/projects/test/manifest', {
    method: 'PUT', body: JSON.stringify({ name: 'Test', files: {}, baseVersion: null }) })
  expect(response.status).toBe(200)
  const objects = await Promise.all((await ctx.store.list(keys.wallets)).map((key) => ctx.store.head(key)))
  const bytes = objects.reduce((sum, object) => sum + (object?.size ?? 0), 0)
  ctx.env.store = await createQuotaStore(ctx.store, { maxStorageBytes: bytes, maxStorageObjects: 2 })
  expect((await ctx.wallet.signedFetch(BASE + '/projects/test', { method: 'DELETE' })).status).toBe(200)
})

it('removes empty filesystem directories and keeps a free-space reserve', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dcl-capacity-'))
  directories.push(directory)
  const store = createFsStore(directory)
  await store.put('wallets/test/projects/project/manifest.json', new Uint8Array(1), { metadata: { name: 'test' } })
  await store.delete('wallets/test/projects/project/manifest.json')
  await expect(stat(path.join(directory, 'wallets', 'test'))).rejects.toHaveProperty('code', 'ENOENT')
  const full = createFsStore(directory, Number.MAX_SAFE_INTEGER)
  await expect(full.put('blobs/new', new Uint8Array(1))).rejects.toBeInstanceOf(StorageFull)
})

it('drops a stalled JSON body instead of holding an HTTP connection indefinitely', async () => {
  const ctx = await setup(false)
  const url = BASE + '/projects/test/manifest'
  const headers = ctx.wallet.headers('PUT', url)
  const body = new ReadableStream<Uint8Array>()
  vi.useFakeTimers()
  const init = { method: 'PUT', headers, body, duplex: 'half' }
  const response = ctx.send(new Request(url, init))
  await vi.waitFor(() => expect(body.locked).toBe(true))
  await vi.advanceTimersByTimeAsync(30_000)
  expect((await response).status).toBe(408)
})

it('refuses production traffic through the experimental Worker adapter', async () => {
  const bindings = { LOCAL_WORKER_EMULATION: 'true', BUCKET: {
    head: async () => null, get: async () => null, put: async () => null,
    delete: async () => {}, list: async () => ({ objects: [], truncated: false })
  } }
  expect((await worker.fetch(new Request('https://service.example/projects'), bindings)).status).toBe(503)
  expect((await worker.fetch(new Request('http://localhost/projects'), { ...bindings, LOCAL_WORKER_EMULATION: undefined })).status).toBe(503)
})
