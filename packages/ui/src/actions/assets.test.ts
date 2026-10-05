// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { uiFetchCatalog } from './assets'

afterEach(() => vi.unstubAllGlobals())

it('a host that answers every path with its index.html is no catalog proxy, and a failed catalog is reported', async () => {
  const fetchMock = vi.fn((url: string) =>
    url === '/opendcl/ping'
      ? Promise.resolve(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))
      : Promise.reject(new TypeError('Failed to fetch'))
  )
  vi.stubGlobal('fetch', fetchMock)
  await expect(uiFetchCatalog()).rejects.toThrow('Failed to fetch')
  expect(fetchMock).toHaveBeenLastCalledWith('https://models.dclregenesislabs.xyz/catalog/asset-catalog.json')
  expect(state.assetCatalogFailed).toBe(true)
  expect(state.assetBusy).toBe(false)
})
