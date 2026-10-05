import type { AiEvent, AiProviderInfo, AiSendParams } from './shell'

export const ASSISTANT_MAX_FILE_BYTES = 256 * 1024
export const ASSISTANT_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const ASSISTANT_MAX_MESSAGE_BYTES = 12 * 1024 * 1024
export const ASSISTANT_ID = /^[a-zA-Z0-9-]{1,80}$/
export const ASSISTANT_PROTOCOL = 'dcl-assistant-v1'
export const ASSISTANT_TICKET_PREFIX = 'dcl-ticket.'

export type BrowserToolName = 'list_files' | 'read_file' | 'write_file' | 'scene_request' | 'build'
export interface BrowserToolCall {
  kind: 'call'
  turnId: string
  callId: string
  tool: BrowserToolName
  args: Record<string, unknown>
}
export type AssistantClientMessage =
  | { kind: 'prompt'; turnId: string; projectId: string; params: AiSendParams }
  | { kind: 'result'; turnId: string; callId: string; ok: boolean; text: string }
  | { kind: 'stop'; turnId: string }
  | { kind: 'reset' }

export type AssistantServerMessage =
  | { kind: 'ready'; providers: AiProviderInfo[] }
  | { kind: 'event'; event: AiEvent }
  | BrowserToolCall
  | { kind: 'failure'; message: string }

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function assistantReadable(path: string): boolean {
  if (path.length === 0 || path.length > 512 || /[\\\x00-\x1f\x7f:]/.test(path)) return false
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '..' || part.startsWith('.') || part === 'node_modules' || part === 'bin')) return false
  return /\.(ts|tsx|js|jsx|json|md|txt)$/i.test(path)
}

export function assistantWritable(path: string): boolean {
  return assistantReadable(path) && /^src\//.test(path) && /\.(ts|tsx|js|jsx)$/.test(path) &&
    !path.split('/').includes('runtime')
}
