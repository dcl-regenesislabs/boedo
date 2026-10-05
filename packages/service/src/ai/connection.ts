import { ASSISTANT_ID, ASSISTANT_MAX_IMAGE_BYTES, object } from '../../../contract/src/assistant.ts'
import type { AssistantServerMessage, BrowserToolName } from '../../../contract/src/assistant.ts'
import type { AiSendParams } from '../../../contract/src/shell.ts'
import type { AgentFactory, AssistantAgent } from './types.ts'

const MAX_TURN_RESULT_CHARS = 2_000_000

interface Pending {
  turnId: string
  finish(ok: boolean, text: string): void
}

export function parsePrompt(value: unknown): AiSendParams | null {
  if (!object(value) || !['claude', 'codex'].includes(String(value.provider))) return null
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 32_000) return null
  if (value.context !== undefined && (typeof value.context !== 'string' || value.context.length > 128_000)) return null
  if (value.model !== undefined && (typeof value.model !== 'string' || value.model.length > 120)) return null
  if (value.images !== undefined && (!Array.isArray(value.images) || value.images.length > 4 || value.images.some((image) =>
    !object(image) || typeof image.name !== 'string' || image.name.length > 200 ||
    typeof image.dataUrl !== 'string' || image.dataUrl.length > Math.ceil(ASSISTANT_MAX_IMAGE_BYTES / 3) * 4 + 64 ||
    !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)
  ))) return null
  return value as unknown as AiSendParams
}

export function createConnection(options: {
  factory: AgentFactory
  send(message: AssistantServerMessage): void
  allowTurn(): boolean
  toolTimeoutMs?: number
  turnTimeoutMs?: number
}) {
  let agent: AssistantAgent | null = null
  let identity = ''
  let active: { id: string; controller: AbortController; chars: number; resumable: boolean } | null = null
  let closed = false
  let running: Promise<void> | undefined
  let stopping: Promise<void> | undefined
  const pending = new Map<string, Pending>()
  const send = (message: AssistantServerMessage) => { if (!closed) options.send(message) }

  function abort(message?: string, resumable = false): void {
    if (message !== undefined && active !== null && !active.controller.signal.aborted) {
      active.resumable = resumable
      send({ kind: 'event', event: { kind: 'error', turnId: active.id, message, ...(resumable ? { resumable } : {}) } })
    }
    active?.controller.abort()
    for (const request of pending.values()) request.finish(false, 'The turn was cancelled.')
    stopping = agent?.abort().catch(() => send({ kind: 'failure', message: 'Unable to stop the assistant.' }))
  }

  async function call(tool: BrowserToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const turn = active
    if (turn === null || turn.controller.signal.aborted || signal?.aborted) throw new Error('Turn cancelled')
    const callId = crypto.randomUUID()
    return new Promise<string>((resolve, reject) => {
      const cancel = () => finish(false, 'The turn was cancelled.')
      const timer = setTimeout(() => {
        finish(false, 'The browser did not answer the tool request.')
        abort('A browser action timed out. The turn stopped; check the scene before retrying.')
      }, options.toolTimeoutMs ?? 60_000)
      function finish(ok: boolean, text: string) {
        if (!pending.delete(callId)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        turn!.controller.signal.removeEventListener('abort', cancel)
        if (ok) resolve(text)
        else reject(new Error(text))
      }
      pending.set(callId, { turnId: turn.id, finish })
      signal?.addEventListener('abort', cancel, { once: true })
      turn.controller.signal.addEventListener('abort', cancel, { once: true })
      send({ kind: 'call', turnId: turn.id, callId, tool, args })
    })
  }

  async function prompt(turnId: string, projectId: string, params: AiSendParams): Promise<void> {
    const turn = { id: turnId, controller: new AbortController(), chars: 0, resumable: false }
    active = turn
    send({ kind: 'event', event: { kind: 'started', turnId } })
    let ok = false
    const timer = setTimeout(() => abort('The turn reached its 10-minute limit.', true), options.turnTimeoutMs ?? 10 * 60_000)
    try {
      const key = JSON.stringify([projectId, params.provider, params.model])
      if (identity !== key) {
        agent?.dispose()
        agent = null
        identity = key
      }
      if (agent === null) {
        const created = await options.factory.create(params, call, ({ text }) => {
          if (active !== null && !active.controller.signal.aborted) send({ kind: 'event', event: { kind: 'text', turnId: active.id, text } })
        })
        if (closed || turn.controller.signal.aborted) {
          created.dispose()
          return
        }
        agent = created
      }
      await stopping
      turn.controller.signal.throwIfAborted()
      await agent.prompt(params)
      ok = !turn.controller.signal.aborted
    } catch {
      if (!turn.controller.signal.aborted) {
        send({ kind: 'event', event: { kind: 'error', turnId, message: 'The assistant could not finish. Check the service connection and provider sign-in, then retry.' } })
      }
    } finally {
      clearTimeout(timer)
      turn.controller.abort()
      active = null
      if (!ok && (!turn.resumable || closed)) {
        agent?.dispose()
        agent = null
      }
      send({ kind: 'event', event: { kind: 'done', turnId, ok } })
    }
  }

  return {
    receive(message: unknown): void {
      if (closed || !object(message)) return
      if (message.kind === 'result') {
        if (typeof message.callId !== 'string' || typeof message.turnId !== 'string' ||
          typeof message.ok !== 'boolean' || typeof message.text !== 'string' || message.text.length > 600_000) return
        const request = pending.get(message.callId)
        if (request?.turnId !== message.turnId || active?.id !== message.turnId) return
        active.chars += message.text.length
        if (active.chars > MAX_TURN_RESULT_CHARS) {
          request.finish(false, 'The tool results for this turn are too large.')
          abort('The turn read as much as one turn can hold.', true)
          return
        }
        request.finish(message.ok, message.text)
        return
      }
      if (message.kind === 'stop' && message.turnId === active?.id) { abort(); return }
      if (message.kind === 'reset') {
        if (active !== null) { abort(); return }
        agent?.dispose()
        agent = null
        identity = ''
        return
      }
      if (message.kind !== 'prompt') return
      const params = parsePrompt(message.params)
      if (typeof message.turnId !== 'string' || !ASSISTANT_ID.test(message.turnId) ||
        typeof message.projectId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(message.projectId) || params === null) {
        send({ kind: 'failure', message: 'Invalid prompt. Use up to four images, at most 2 MB each.' })
        return
      }
      if (active !== null || !options.allowTurn()) {
        send({ kind: 'failure', message: active !== null ? 'A turn is already running.' : 'Too many requests. Try again shortly.' })
        return
      }
      running = prompt(message.turnId, message.projectId, params)
    },
    async close(): Promise<void> {
      closed = true
      abort()
      if (active === null) {
        agent?.dispose()
        agent = null
      }
      await Promise.all([running, stopping])
    }
  }
}
