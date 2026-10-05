// Sends a signed deployment to the Worlds content server: one multipart
// `POST <server>/entities`, in the form dcl-catalyst-client's deploy() writes.
import type { AuthChain } from '@ui/engine/hosted'
import type { Deployment } from './entity'
import { PublishError, UNREACHABLE, refusal } from './errors'

// the server takes at most 500 per request; a url of 100 stays well under 8 KB
const CIDS_PER_REQUEST = 100
const ATTEMPTS = 3
const RETRY_MS = 1500

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'
const cancelled = (): PublishError => new PublishError('cancelled', 'Publishing was cancelled.')

function deploymentForm(entityId: string, authChain: AuthChain, files: Iterable<readonly [string, Uint8Array]>): FormData {
  const form = new FormData()
  form.append('entityId', entityId)
  authChain.forEach((link, index) => {
    form.append(`authChain[${index}][type]`, link.type)
    form.append(`authChain[${index}][payload]`, link.payload)
    form.append(`authChain[${index}][signature]`, link.signature)
  })
  // the part's name and its file name are both the hash
  for (const [hash, bytes] of files) form.append(hash, new Blob([bytes as Uint8Array<ArrayBuffer>]), hash)
  return form
}

// The hashes the server already stores, which a deployment may leave out.
// Empty when it cannot say: everything is uploaded then.
async function storedHashes(base: string, hashes: string[], signal?: AbortSignal): Promise<Set<string>> {
  const stored = new Set<string>()
  try {
    for (let at = 0; at < hashes.length; at += CIDS_PER_REQUEST) {
      const query = hashes.slice(at, at + CIDS_PER_REQUEST).map((hash) => `cid=${hash}`).join('&')
      const response = await fetch(`${base}/available-content?${query}`, { signal })
      if (!response.ok) return new Set()
      const list: unknown = await response.json()
      if (!Array.isArray(list)) return new Set()
      for (const item of list as { cid?: unknown; available?: unknown }[]) {
        if (typeof item.cid === 'string' && item.available === true) stored.add(item.cid)
      }
    }
  } catch (error) {
    if (isAbort(error)) throw error
    return new Set()
  }
  return stored
}

export function validAuthChain(chain: unknown, entityId: string): chain is AuthChain {
  if (!Array.isArray(chain) || chain.length < 2) return false
  const links = chain as { type?: unknown; payload?: unknown; signature?: unknown }[]
  if (!links.every((link) => typeof link?.type === 'string' && typeof link.payload === 'string' && typeof link.signature === 'string')) {
    return false
  }
  return links[0].type === 'SIGNER' && links[links.length - 1].payload === entityId
}

export interface UploadInput {
  // the Worlds content server, no trailing slash
  server: string
  world: string
  deployment: Deployment
  authChain: AuthChain
  signal?: AbortSignal
  // each try after the first, with why the one before it failed
  onRetry?: (attempt: number, why: string) => void
  onProgress?: (line: string) => void
}

// Resolves with the server's own sentence about the deployment.
export async function uploadDeployment(input: UploadInput): Promise<string> {
  const { deployment, server, signal } = input
  try {
    const all = [...deployment.files]
    const stored = await storedHashes(server, [...deployment.files.keys()], signal)
    // the entity file always goes: it is what the server reads the deployment from
    let parts = all.filter(([hash]) => hash === deployment.entityId || !stored.has(hash))
    const bytes = parts.reduce((sum, [, file]) => sum + file.length, 0)
    const size = `${Math.ceil(bytes / 1024)} KB`
    input.onProgress?.(
      parts.length === all.length
        ? `Uploading ${all.length - 1} files (${size}).`
        : `Uploading ${parts.length - 1} of ${all.length - 1} files (${size}): the server already has the others.`
    )
    let failure = new PublishError('network', UNREACHABLE, true)
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) {
        input.onRetry?.(attempt, failure.detail ?? failure.message)
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS * (attempt - 1)))
        if (signal?.aborted === true) throw cancelled()
      }
      let response: Response
      try {
        response = await fetch(`${server}/entities`, {
          method: 'POST',
          body: deploymentForm(deployment.entityId, input.authChain, parts),
          signal
        })
      } catch (error) {
        if (isAbort(error)) throw error
        failure = new PublishError('network', UNREACHABLE, true, error instanceof Error ? error.message : String(error))
        continue
      }
      const body = await response.text()
      if (response.ok) {
        try {
          const message: unknown = (JSON.parse(body) as { message?: unknown }).message
          return typeof message === 'string' ? message : ''
        } catch {
          return ''
        }
      }
      failure = refusal(response.status, body, input.world)
      // a file the server said it had is gone: send them all
      if (parts.length < all.length && /neither present in the storage/.test(failure.detail ?? '')) {
        parts = all
        continue
      }
      // only what a second try can change: the server being down, busy or slow
      if (response.status < 500 && response.status !== 408 && response.status !== 429) throw failure
    }
    throw failure
  } catch (error) {
    if (isAbort(error)) throw cancelled()
    throw error
  }
}
