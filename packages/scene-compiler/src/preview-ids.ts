// Preview ids in sdk-commands' local-scene scheme: "b64-" + base64 of
// "<root>-<machineId>" (entity) or "<root>/<file>\0<version>-<machineId>" (content).

export const PREVIEW_MACHINE_ID = 'web'
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// no "-": the id is split at one to tell the machine id from the path
const MACHINE_ID_PATTERN = /^[A-Za-z0-9_.]{1,64}$/

const VERSION_SEPARATOR = '\u0000'

function toBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)))
}

export function previewProjectRoot(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`Invalid preview project id "${projectId}"`)
  return `/preview/${projectId}`
}

function suffix(machineId: string): string {
  if (!MACHINE_ID_PATTERN.test(machineId)) throw new Error(`Invalid preview machine id "${machineId}"`)
  return '-' + machineId
}

// machineId tells apart two creators' previews of a same-named project
export const previewEntityId = (projectId: string, machineId = PREVIEW_MACHINE_ID): string =>
  'b64-' + toBase64(previewProjectRoot(projectId) + suffix(machineId))

export const previewContentId = (projectId: string, file: string, version: string, machineId = PREVIEW_MACHINE_ID): string =>
  'b64-' + toBase64(`${previewProjectRoot(projectId)}/${file}${VERSION_SEPARATOR}${version}${suffix(machineId)}`)

// file is '' for an entity id; null for an id that is not a preview id
export function decodePreviewId(
  id: string
): { projectId: string; file: string; version: string | undefined; machineId: string } | null {
  if (!id.startsWith('b64-')) return null
  let decoded: string
  try {
    decoded = fromBase64(id.slice('b64-'.length))
  } catch {
    return null
  }
  const dash = decoded.lastIndexOf('-')
  const machineId = decoded.slice(dash + 1)
  if (dash === -1 || !MACHINE_ID_PATTERN.test(machineId)) return null
  const [path, version] = decoded.slice(0, dash).split(VERSION_SEPARATOR)
  const match = /^\/preview\/([^/]+)(?:\/(.+))?$/.exec(path)
  if (match === null || !PROJECT_ID_PATTERN.test(match[1])) return null
  return { projectId: match[1], file: match[2] ?? '', version, machineId }
}

// Web APIs reject shared memory; project bytes are never backed by it
export const plainBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => bytes as Uint8Array<ArrayBuffer>

export async function contentVersion(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', plainBytes(bytes)))
  // digits only (the engine splits the id at the first "-"); 48 bits stay an exact integer
  return String(digest.slice(0, 6).reduce((value, byte) => value * 256 + byte, 0))
}
