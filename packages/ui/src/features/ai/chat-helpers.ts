// Copy and small pure helpers for the chat surface.
import { object } from '@dcl-editor/contract'
import type { AiImageAttachment, AiProvider } from '@dcl-editor/contract'
import type { ChatMsg } from './transcript'

export const MAX_ATTACH = 4
const MAX_ATTACH_BYTES = 8 * 1024 * 1024

export function readImages(files: Iterable<File>, room: number, maxBytes = MAX_ATTACH_BYTES): Promise<AiImageAttachment[]> {
  const picked = [...files].filter((f) => f.type.startsWith('image/') && f.size > 0 && f.size <= maxBytes).slice(0, room)
  return Promise.all(
    picked.map(
      (f) =>
        new Promise<AiImageAttachment>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve({ name: f.name === '' ? 'pasted image' : f.name, dataUrl: String(r.result) })
          r.onerror = () => reject(new Error(`could not read ${f.name}`))
          r.readAsDataURL(f)
        })
    )
  )
}

export const EXAMPLES = [
  'Open the door on pointer down, close it after 3s',
  'Make this entity spin slowly around Y',
  'Build a stone tower with a wooden spiral staircase',
  'Add a dog that wags its tail',
]

// One-tap prompts shown when a code range is attached (for creators who don't read TS).
export const QUICK_ACTIONS: Array<[string, string]> = [
  ['Explain', 'Explain what the selected code does, in plain language.'],
  ['Fix', 'Find and fix any bugs in the selected code.'],
  ['Comment', 'Add clear, concise comments to the selected code.'],
  ['Improve', 'Improve the selected code — clarity and correctness — without changing what it does.']
]

// Install + sign-in steps shown when a provider's CLI isn't available.
export const SETUP: Record<AiProvider, { install: string; signIn: string }> = {
  claude: { install: 'npm i -g @anthropic-ai/claude-code', signIn: 'claude' },
  codex: { install: 'npm i -g @openai/codex', signIn: 'codex login' }
}

// The CLI's own error text is for developers; creators get the next action.
export function friendlyError(raw: string, hosted = false): string {
  if (hosted) return raw
  const s = raw.toLowerCase()
  if (s.includes('not found') || s.includes('enoent')) return "The assistant's CLI isn't installed or on PATH."
  if (s.includes('logged in') || s.includes('login') || s.includes('unauthorized') || s.includes('401'))
    return 'Not signed in — sign in to your subscription from a terminal, then try again.'
  if (s.includes('open a scene')) return 'Open a scene first, then ask the assistant.'
  if (s.includes('rate') && s.includes('limit')) return "You've hit your plan's rate limit — wait a moment and retry."
  if (s.includes('timed out') || s.includes('timeout')) return 'The request timed out. Try again.'
  return "The assistant hit an error. Retry, or check it's signed in."
}

export function composerPlaceholder(available: boolean, hasSelection: boolean): string {
  if (!available) return 'Assistant unavailable'
  if (hasSelection) return 'Ask about the selected code…'
  return 'Describe what you want it to do…'
}

// The CLI reports paths its own way (backslashes, ./ prefixes) — match them
// against the file the editor has open.
export function sameFile(reported: string, open: string): boolean {
  const a = reported.replace(/\\/g, '/').replace(/^\.\//, '')
  const b = open.replace(/^\.\//, '')
  return a === b || a.endsWith(`/${b}`)
}

const KEPT_MESSAGES = 100
const KEPT_BYTES = 256 * 1024

// What a chat keeps across reloads: finished text and tool chips, no images, at most ~256 KB.
export function keptTranscript(messages: ChatMsg[]): ChatMsg[] {
  const kept: ChatMsg[] = []
  for (const m of messages) {
    if (m.role === 'user') kept.push({ role: 'user', text: m.text })
    else if (m.role === 'assistant' && m.done) {
      kept.push({ role: 'assistant', text: m.text, tools: m.tools, done: true, ...(m.error === undefined ? {} : { error: m.error }), ...(m.models === undefined ? {} : { models: m.models }), ...(m.thumbnails === undefined ? {} : { thumbnails: m.thumbnails }) })
    }
  }
  let out = kept.slice(-KEPT_MESSAGES)
  while (out.length > 0 && JSON.stringify(out).length > KEPT_BYTES) out = out.slice(1)
  return out
}

// a restored card may only point at a built model file in the project
const MODEL_FILE = /^models\/[a-z0-9-]+\.glb$/
const THUMBNAIL_FILE = /^assets\/images\/thumbnail-(\d+)\.jpg$/

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= KEPT_BYTES
}

// Stored data is only trusted once it reads back as plain chat rows.
export function restoredTranscript(value: unknown): ChatMsg[] {
  if (!Array.isArray(value)) return []
  const out: ChatMsg[] = []
  for (const row of value.slice(-KEPT_MESSAGES) as unknown[]) {
    if (!object(row) || !isText(row.text)) continue
    if (row.role === 'user') out.push({ role: 'user', text: row.text })
    else if (row.role === 'assistant' && Array.isArray(row.tools)) {
      const tools = (row.tools as unknown[]).flatMap((t) =>
        object(t) && isText(t.tool) && isText(t.detail) ? [{ tool: t.tool, detail: t.detail }] : []
      )
      const models = Array.isArray(row.models) ? (row.models as unknown[]).flatMap((b) =>
        object(b) && isText(b.name) && isText(b.path) && MODEL_FILE.test(b.path) && typeof b.triangles === 'number' && Number.isFinite(b.triangles)
          ? [{ name: b.name, path: b.path, triangles: b.triangles }] : []
      ) : []
      const thumbnails = Array.isArray(row.thumbnails) ? (row.thumbnails as unknown[]).flatMap((t) => {
        const version = object(t) && isText(t.path) ? THUMBNAIL_FILE.exec(t.path)?.[1] : undefined
        return version === undefined || !object(t) || t.version !== Number(version) ? [] : [{ path: t.path as string, version: t.version }]
      }) : []
      out.push({
        role: 'assistant', text: row.text, tools, done: true, ...(isText(row.error) ? { error: row.error } : {}),
        ...(models.length > 0 ? { models } : {}), ...(thumbnails.length > 0 ? { thumbnails } : {})
      })
    }
  }
  return out
}
