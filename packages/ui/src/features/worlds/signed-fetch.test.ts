import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setHost, type DclEditorHostV1 } from '../../engine/hosted'

const identity = { value: null as unknown }
vi.mock('../account/auth', () => ({ getIdentity: () => identity.value }))
vi.mock('@dcl/crypto', () => ({
  Authenticator: { signPayload: () => [{ type: 'SIGNER', payload: '0xabc', signature: '' }] }
}))

import { SIGN_CANCELLED, SIGN_IN_REQUIRED, SIGN_UNAVAILABLE, signedFetch } from './signed-fetch'

const STORAGE = 'https://storage.decentraland.zone'

function hostWith(signedFetchImpl: DclEditorHostV1['signedFetch']): DclEditorHostV1 {
  return {
    version: 1,
    services: {
      projects: null,
      worldsContent: 'https://worlds-content-server.decentraland.zone',
      signed: {
        worldsContent: 'https://worlds-content-server.decentraland.zone',
        commsGatekeeper: 'https://comms-gatekeeper.decentraland.zone',
        storage: STORAGE,
        creatorsData: 'https://creators-data.decentraland.org/v2',
        multiplayer: 'https://multiplayer-server.decentraland.zone'
      }
    },
    signedFetch: signedFetchImpl
  } as unknown as DclEditorHostV1
}

const fetchMock = vi.fn()

beforeEach(() => {
  identity.value = null
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {})
})

afterEach(() => {
  setHost(null)
  vi.unstubAllGlobals()
})

describe('signedFetch', () => {
  it('hosted with signed services, hands the request to the page to sign', async () => {
    const hostFetch = vi.fn().mockResolvedValue(new Response('ok'))
    setHost(hostWith(hostFetch))
    const signal = new AbortController().signal
    const meta = { realmName: 'boedo.dcl.eth', parcel: '0,0' }

    await signedFetch(`${STORAGE}/values?limit=50`, { method: 'PUT', headers: { 'X-Confirm-Delete-All': 'true' }, body: '{}', signal }, meta)

    expect(hostFetch).toHaveBeenCalledWith(`${STORAGE}/values?limit=50`, {
      method: 'PUT',
      headers: { 'x-confirm-delete-all': 'true' },
      body: '{}',
      metadata: meta,
      signal
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps the page refusals to what the worlds screens already handle', async () => {
    setHost(hostWith(() => Promise.reject(new Error('not-signed-in'))))
    await expect(signedFetch(STORAGE)).rejects.toThrow(SIGN_IN_REQUIRED)
    setHost(hostWith(() => Promise.reject(new Error('cancelled'))))
    await expect(signedFetch(STORAGE, { method: 'DELETE' })).rejects.toThrow(SIGN_CANCELLED)
  })

  it('hosted without signed services, refuses instead of asking a signed-in player to sign in', async () => {
    const host = hostWith(vi.fn())
    setHost({ ...host, services: { ...host.services, signed: undefined } })
    identity.value = null

    await expect(signedFetch(STORAGE)).rejects.toMatchObject({ message: SIGN_UNAVAILABLE })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('on desktop, signs with the renderer identity and fetches directly', async () => {
    identity.value = { ephemeralIdentity: {}, authChain: [] }

    await signedFetch(`${STORAGE}/values`, { method: 'GET' }, { parcel: '0,0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(url).toBe(`${STORAGE}/values`)
    expect(headers['x-identity-auth-chain-0']).toBe(JSON.stringify({ type: 'SIGNER', payload: '0xabc', signature: '' }))
    expect(headers['x-identity-metadata']).toBe('{"parcel":"0,0"}')
  })
})
