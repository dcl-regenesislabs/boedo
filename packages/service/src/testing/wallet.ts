// A wallet for tests and scripts: signs requests the way the editor host does (ADR-44 signed fetch).
import { AuthLinkType, Authenticator } from '@dcl/crypto'
import type { AuthIdentity, IdentityType } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto.js'
import { INTENT, SIGNER } from '../auth.ts'

export interface SignOverrides {
  /** Replaces the whole signed metadata object. */
  metadata?: Record<string, unknown>
  /** ms since epoch; defaults to now. */
  timestamp?: number
  /** Sign this path instead of the url's own. */
  pathname?: string
}

export interface TestWallet {
  /** Lowercase address of the owner account. */
  address: string
  origin: string
  /** The ADR-44 headers, plus `origin`, for one request. */
  headers(method: string, url: string, overrides?: SignOverrides): Record<string, string>
  /** Same shape as the host's `signedFetch`. */
  signedFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: BodyInit | null }): Promise<Response>
  /** The same account signed in elsewhere: same owner, a new ephemeral key. */
  anotherDevice(): Promise<TestWallet>
}

export interface TestWalletOptions {
  origin?: string
  owner?: IdentityType
  /** Where signedFetch sends the request; defaults to the global fetch. */
  fetch?: (request: Request) => Promise<Response>
  now?: () => number
  /** How long the ephemeral key is valid from `now`; defaults to an hour. */
  validMinutes?: number
}

export async function createTestWallet(options: TestWalletOptions = {}): Promise<TestWallet> {
  const origin = options.origin ?? 'http://localhost:5230'
  const now = options.now ?? Date.now
  const send = options.fetch ?? ((request: Request) => fetch(request))
  const owner = options.owner ?? createUnsafeIdentity()
  const ephemeral = createUnsafeIdentity()
  // expires relative to `now`, so a test clock can move a device past its delegation
  const expiration = new Date(now() + (options.validMinutes ?? 60) * 60_000)
  const message = Authenticator.getEphemeralMessage(ephemeral.address, expiration)
  const identity: AuthIdentity = {
    ephemeralIdentity: ephemeral,
    expiration,
    authChain: [
      { type: AuthLinkType.SIGNER, payload: owner.address, signature: '' },
      { type: AuthLinkType.ECDSA_PERSONAL_EPHEMERAL, payload: message, signature: Authenticator.createSignature(owner, message) }
    ]
  }

  const wallet: TestWallet = {
    address: owner.address.toLowerCase(),
    origin,
    headers(method, url, overrides = {}) {
      const metadata = JSON.stringify(overrides.metadata ?? { intent: INTENT, signer: SIGNER, origin })
      const timestamp = String(overrides.timestamp ?? now())
      const { pathname: path, search } = new URL(url)
      const pathname = overrides.pathname ?? `${path}${search}`
      const payload = [method, pathname, timestamp, metadata].join(':').toLowerCase()
      const headers: Record<string, string> = { origin, 'x-identity-timestamp': timestamp, 'x-identity-metadata': metadata }
      Authenticator.signPayload(identity, payload).forEach((link, index) => {
        headers[`x-identity-auth-chain-${index}`] = JSON.stringify(link)
      })
      return headers
    },
    signedFetch(url, init = {}) {
      const method = init.method ?? 'GET'
      const headers = { ...init.headers, ...wallet.headers(method, url) }
      return send(new Request(url, { method, headers, body: init.body }))
    },
    anotherDevice: () => createTestWallet({ ...options, owner })
  }
  return wallet
}
