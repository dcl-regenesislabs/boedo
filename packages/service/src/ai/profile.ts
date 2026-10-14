import { object } from '../../../contract/src/assistant.ts'
import { sniff, type PictureData } from './images.ts'

const PROFILES_URL = 'https://peer.decentraland.org/lambdas/profiles/'
const TIMEOUT_MS = 10_000
const MAX_BYTES = 2 * 1024 * 1024

/** The wallet's full-body avatar snapshot, or null when it has none or the catalyst is unreachable. */
export async function profileAvatar(wallet: string, signal?: AbortSignal): Promise<PictureData | null> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
  try {
    const profile: unknown = await (await fetch(PROFILES_URL + wallet.toLowerCase(), { signal: combined })).json()
    const avatars = object(profile) && Array.isArray(profile.avatars) ? profile.avatars : []
    const avatar = object(avatars[0]) && object(avatars[0].avatar) ? avatars[0].avatar : undefined
    const body = avatar !== undefined && object(avatar.snapshots) ? avatar.snapshots.body : undefined
    if (typeof body !== 'string' || !body.startsWith('https://')) return null
    const response = await fetch(body, { signal: combined })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_BYTES) return null
    const data = bytes.toString('base64')
    const mimeType = sniff(data)
    return mimeType === null ? null : { mimeType, data }
  } catch {
    return null
  }
}
