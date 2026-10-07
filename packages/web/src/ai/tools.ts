import { ASSISTANT_MAX_FILE_BYTES, assistantReadable, assistantWritable } from '@dcl-editor/contract'
import type { BrowserToolCall } from '@dcl-editor/contract'

export interface BrowserProject {
  files(): ReadonlyMap<string, Uint8Array>
  write(path: string, bytes: Uint8Array, expected: Uint8Array | null, signal: AbortSignal): Promise<void>
  scene(request: unknown, signal: AbortSignal): Promise<unknown>
  build(signal: AbortSignal): Promise<unknown>
  // after a successful write; answers the entity a new script was attached to
  written?(path: string, content: string, created: boolean): Promise<{ id: string; name: string } | null>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function sameBytes(a: Uint8Array | undefined, b: Uint8Array | null): boolean {
  return a === undefined ? b === null : b !== null && a.length === b.length && a.every((v, i) => v === b[i])
}

function parseRequest(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Invalid scene request.')
  }
}

const REFERENCED_ASSET = /^(?!node_modules\/|bin\/)[^.][^\0]*\.(glb|gltf|png|jpe?g|webp|ktx2|mp3|ogg|wav|mp4)$/i

export function createBrowserTools(project: BrowserProject) {
  const reads = new Map<string, { revision: string; bytes: Uint8Array }>()
  return async (call: BrowserToolCall, signal: AbortSignal): Promise<string> => {
    signal.throwIfAborted()
    const { tool, args } = call
    if (tool === 'list_files') {
      // models, images and sounds too: they can't be read, but scripts and components name them by path
      return JSON.stringify([...project.files().keys()].filter((path) => assistantReadable(path) || REFERENCED_ASSET.test(path)).sort().slice(0, 2000))
    }
    if (tool === 'build') return JSON.stringify(await project.build(signal))
    if (tool === 'scene_request') {
      // some models send the request object as JSON text
      return JSON.stringify(await project.scene(typeof args.request === 'string' ? parseRequest(args.request) : args.request, signal))
    }
    const path = args.path
    if (typeof path !== 'string' || !assistantReadable(path)) throw new Error('This path is not an assistant-readable project file.')
    const bytes = project.files().get(path)
    if (tool === 'read_file') {
      if (bytes === undefined) return JSON.stringify({ path, content: null, revision: null })
      if (bytes.byteLength > ASSISTANT_MAX_FILE_BYTES) throw new Error('This file is too large for the assistant.')
      const content = decoder.decode(bytes)
      const revision = crypto.randomUUID()
      reads.set(path, { revision, bytes: bytes.slice() })
      return JSON.stringify({ path, content, revision })
    }
    if (tool !== 'write_file' || !assistantWritable(path)) throw new Error('The assistant can write source files; scene data is changed through editor actions.')
    if (typeof args.content !== 'string') throw new Error('Missing file content.')
    const next = encoder.encode(args.content)
    if (next.byteLength > ASSISTANT_MAX_FILE_BYTES) throw new Error('This file is too large for the assistant.')
    const read = reads.get(path)
    const expected = args.revision === null ? null : read?.bytes
    if (expected === undefined || (args.revision !== null && args.revision !== read?.revision)) {
      throw new Error('Read this file before changing it.')
    }
    await project.write(path, next, expected, signal)
    signal.throwIfAborted()
    const revision = crypto.randomUUID()
    reads.set(path, { revision, bytes: next })
    const attached = (await project.written?.(path, args.content, expected === null)) ?? null
    return JSON.stringify({ path, revision, created: expected === null, ...(attached === null ? {} : { attached }) })
  }
}
