import { Authenticator } from '@dcl/crypto'
import type { AuthChain } from '@dcl/crypto'
import { WALLET } from './paths.ts'

export const INTENT = 'dcl:editor:projects'
export const SIGNER = 'dcl:editor'
export const TIMESTAMP_WINDOW_MS = 60 * 1000

const SCENE_SIGNER = 'decentraland-kernel-scene'
// what the engine adds when it signs for a scene (crates/dcl/src/js/fetch.rs) or for a scene's server
const SCENE_FIELDS = ['sceneId', 'parcel', 'realm', 'realmName']
const CONTRACT_WALLET_LINKS = ['ECDSA_EIP_1654_EPHEMERAL', 'ECDSA_EIP_1654_SIGNED_ENTITY']
const EPHEMERAL_LINKS = ['ECDSA_EPHEMERAL', 'ECDSA_EIP_1654_EPHEMERAL']
const SIGNED_LINKS = ['ECDSA_SIGNED_ENTITY', 'ECDSA_EIP_1654_SIGNED_ENTITY']
const CHAIN_LINKS = 3

export type AuthResult = { wallet: string } | { status: 401 | 403; error: string }

export interface AuthOptions {
  now: number
  allowedOrigins: readonly string[]
  /** Longest an ephemeral key may still be valid for. */
  maxDelegationMs: number
  /** JSON-RPC endpoint that answers ERC-1654 checks; without it smart-contract wallets are refused. */
  ethRpcUrl?: string
}

interface JsonRpcCallback {
  (error: Error | null, result?: unknown): void
}

function rpcProvider(url: string): { sendAsync: (payload: unknown, callback: JsonRpcCallback) => void } {
  return {
    sendAsync(payload, callback) {
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) })
        .then((response) => response.json())
        .then(
          (result) => callback(null, result),
          (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)))
        )
    }
  }
}

function readChain(headers: Headers): AuthChain | null {
  const chain: AuthChain = []
  for (let i = 0; i <= CHAIN_LINKS; i++) {
    const header = headers.get(`x-identity-auth-chain-${i}`)
    if (header == null) break
    try {
      const link = JSON.parse(header) as Record<string, unknown> | null
      if (link == null || typeof link.type !== 'string' || typeof link.payload !== 'string') return null
      if (link.signature !== undefined && typeof link.signature !== 'string') return null
      chain.push(link as AuthChain[number])
    } catch {
      return null
    }
  }
  return chain.length === 0 ? null : chain
}

// Only the login shape: owner -> expiring ephemeral key -> this request. A SIGNED_ENTITY right
// after SIGNER would delegate to whatever address its payload names, with no expiry.
function chainProblem(chain: AuthChain, now: number, maxDelegationMs: number): string | null {
  const [signer, ephemeral, signed] = chain
  if (chain.length !== CHAIN_LINKS || signer.type !== 'SIGNER' || !WALLET.test(signer.payload.toLowerCase())) return 'invalid-chain'
  if (!EPHEMERAL_LINKS.includes(ephemeral.type) || !SIGNED_LINKS.includes(signed.type)) return 'invalid-chain'
  // read as @dcl/crypto reads it: the second line names the key, the third its expiry
  const lines = ephemeral.payload.replace(/\r/g, '').split('\n')
  const dated = lines.length >= 3 && lines[1].startsWith('Ephemeral address: ') && lines[2].startsWith('Expiration: ')
  const expires = dated ? Date.parse(lines[2].slice('Expiration: '.length)) : NaN
  if (!Number.isFinite(expires)) return 'invalid-chain'
  if (expires <= now) return 'delegation-expired'
  return expires - now > maxDelegationMs ? 'delegation-too-long' : null
}

/** Verify a Decentraland signed fetch (ADR-44) made by the editor host, and name its wallet. */
export async function authenticate(request: Request, options: AuthOptions): Promise<AuthResult> {
  const chain = readChain(request.headers)
  const timestamp = request.headers.get('x-identity-timestamp')
  const rawMetadata = request.headers.get('x-identity-metadata')
  if (chain == null || timestamp == null || rawMetadata == null) return { status: 401, error: 'unsigned' }
  const problem = chainProblem(chain, options.now, options.maxDelegationMs)
  if (problem != null) return { status: 401, error: problem }

  if (!/^\d{1,15}$/.test(timestamp) || Math.abs(options.now - Number(timestamp)) > TIMESTAMP_WINDOW_MS) {
    return { status: 401, error: 'timestamp-out-of-window' }
  }

  let metadata: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawMetadata)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    metadata = parsed as Record<string, unknown>
  } catch {
    return { status: 401, error: 'invalid-metadata' }
  }
  if (metadata.signer === SCENE_SIGNER || SCENE_FIELDS.some((field) => field in metadata)) {
    return { status: 403, error: 'scene-signed' }
  }
  if (metadata.signer !== SIGNER) return { status: 403, error: 'wrong-signer' }
  if (metadata.intent !== INTENT) return { status: 403, error: 'wrong-intent' }
  const origin = request.headers.get('origin')
  if (typeof metadata.origin !== 'string' || !options.allowedOrigins.includes(metadata.origin)) {
    return { status: 403, error: 'origin-not-allowed' }
  }
  // a browser always sends Origin across origins; a same-origin GET carries none
  if (origin != null && origin !== metadata.origin) return { status: 403, error: 'origin-not-allowed' }

  if (options.ethRpcUrl == null && chain.some((link) => CONTRACT_WALLET_LINKS.includes(link.type))) {
    return { status: 401, error: 'contract-wallet-unsupported' }
  }

  const { pathname, search } = new URL(request.url)
  // the query is signed too, so it can't be changed inside a signed request
  const payload = [request.method, `${pathname}${search}`, timestamp, rawMetadata].join(':').toLowerCase()
  try {
    const provider = options.ethRpcUrl == null ? null : rpcProvider(options.ethRpcUrl)
    const result = await Authenticator.validateSignature(payload, chain, provider, options.now)
    if (!result.ok) return { status: 401, error: 'invalid-signature' }
  } catch {
    return { status: 401, error: 'invalid-signature' }
  }

  return { wallet: Authenticator.ownerAddress(chain).toLowerCase() }
}
