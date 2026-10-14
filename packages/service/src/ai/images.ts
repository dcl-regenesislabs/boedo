import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { object } from '../../../contract/src/assistant.ts'

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface PictureData {
  mimeType: ImageMimeType
  /** base64, no data: prefix */
  data: string
}

export interface ImageRequest {
  prompt: string
  references: PictureData[]
}

/** One image model; another provider (e.g. Vertex Gemini) implements the same. */
export interface ImageProvider {
  generate(request: ImageRequest, signal?: AbortSignal): Promise<PictureData>
}

export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
// the Codex model that runs the image_generation tool; it must take image input for the reference shots
export const CODEX_IMAGE_HOST_MODEL = 'gpt-5.6-terra'
// the widest standard size of the GPT image models; the browser crops it to 16:9
export const CODEX_IMAGE_SIZE = '1536x1024'
const TIMEOUT_MS = 4 * 60_000
const INSTRUCTIONS = 'You produce exactly one image by calling the image_generation tool once, following the brief and its rules. ' +
  'Do not ask questions and do not reply with text.'

// pi's openai-codex-responses reads the account the same way: the ChatGPT account id claim of the access token
export function codexAccountId(token: string): string {
  const part = token.split('.')[1]
  let claims: unknown
  try { claims = JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) } catch { claims = null }
  const auth = object(claims) ? claims['https://api.openai.com/auth'] : undefined
  const id = object(auth) ? auth.chatgpt_account_id : undefined
  if (typeof id !== 'string' || id === '') throw new Error('The image model sign-in has no ChatGPT account. Sign in again with image-login.')
  return id
}

export function codexImageRequest(token: string, request: ImageRequest): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const content = [
    { type: 'input_text', text: request.prompt },
    ...request.references.map((image) => ({ type: 'input_image', detail: 'auto', image_url: `data:${image.mimeType};base64,${image.data}` }))
  ]
  return {
    url: CODEX_RESPONSES_URL,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'chatgpt-account-id': codexAccountId(token),
        originator: 'pi',
        'OpenAI-Beta': 'responses=experimental',
        accept: 'text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: CODEX_IMAGE_HOST_MODEL,
        store: false,
        stream: true,
        instructions: INSTRUCTIONS,
        input: [{ role: 'user', content }],
        tools: [{ type: 'image_generation', size: CODEX_IMAGE_SIZE, quality: 'high', output_format: 'jpeg', background: 'opaque' }],
        tool_choice: { type: 'image_generation' },
        parallel_tool_calls: false
      })
    }
  }
}

// the base64 says what it is, whatever output_format the backend honoured
export function sniff(data: string): ImageMimeType | null {
  if (data.startsWith('/9j/')) return 'image/jpeg'
  if (data.startsWith('iVBORw0KGgo')) return 'image/png'
  if (data.startsWith('UklGR')) return 'image/webp'
  return null
}

function imageOf(item: unknown): PictureData | null {
  if (!object(item) || item.type !== 'image_generation_call' || typeof item.result !== 'string') return null
  const mimeType = sniff(item.result)
  return mimeType === null ? null : { mimeType, data: item.result }
}

function failure(event: Record<string, unknown>): string {
  const nested = object(event.response) && object(event.response.error) ? event.response.error : object(event.error) ? event.error : event
  const message = typeof nested.message === 'string' ? nested.message : typeof nested.code === 'string' ? nested.code : 'unknown error'
  return `The image model failed: ${message.slice(0, 300)}`
}

/** The generated image from a Codex responses SSE stream. */
export async function readCodexImage(body: ReadableStream<Uint8Array>): Promise<PictureData> {
  const decoder = new TextDecoder()
  let buffer = ''
  let image: PictureData | null = null
  const handle = (chunk: string): boolean => {
    const data = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n').trim()
    if (data === '' || data === '[DONE]') return false
    let event: unknown
    try { event = JSON.parse(data) } catch { throw new Error('The image model sent an unreadable answer.') }
    if (!object(event)) return false
    if (event.type === 'error' || event.type === 'response.failed') throw new Error(failure(event))
    if (event.type === 'response.output_item.done') image = imageOf(event.item) ?? image
    if (event.type === 'response.completed' || event.type === 'response.done' || event.type === 'response.incomplete') {
      const output = object(event.response) && Array.isArray(event.response.output) ? event.response.output : []
      for (const item of output) image = imageOf(item) ?? image
      return true
    }
    return false
  }
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (done) buffer += '\n\n'
      for (let at = buffer.indexOf('\n\n'); at !== -1; at = buffer.indexOf('\n\n')) {
        const chunk = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        if (handle(chunk)) return finished(image)
      }
      if (done) return finished(image)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function finished(image: PictureData | null): PictureData {
  if (image === null) throw new Error('The image model answered without an image.')
  return image
}

async function httpFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  const error = object(parsed) ? parsed.error : undefined
  const code = object(error) && typeof error.code === 'string' ? error.code : ''
  if (response.status === 429 || /usage_limit|rate_limit/i.test(code)) return 'The image model has reached its ChatGPT usage limit. Try again later.'
  if (response.status === 401 || response.status === 403) return 'The image model sign-in was refused. The service owner must sign in again with image-login.'
  // the ChatGPT backend reports some refusals (e.g. a retired model) as {detail} rather than {error}
  const detail = object(error) && typeof error.message === 'string' ? error.message : object(parsed) && typeof parsed.detail === 'string' ? parsed.detail : ''
  const message = detail === '' ? '' : `: ${detail.slice(0, 300)}`
  return `The image model failed (HTTP ${response.status})${message}`
}

export function createCodexImageProvider(options: { token(signal?: AbortSignal): Promise<string> }): ImageProvider {
  return {
    async generate(request, signal) {
      const deadline = AbortSignal.timeout(TIMEOUT_MS)
      const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
      const { url, init } = codexImageRequest(await options.token(combined), request)
      const response = await fetch(url, { ...init, signal: combined })
      if (!response.ok) throw new Error(await httpFailure(response))
      if (response.body === null) throw new Error('The image model answered without an image.')
      return readCodexImage(response.body)
    }
  }
}

/** The ChatGPT access token in a pi OAuth session file, refreshed (and saved, mode 0600) by pi when it is about to expire. */
export async function codexTokenSource(authPath: string): Promise<(signal?: AbortSignal) => Promise<string>> {
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false })
  return async (signal) => {
    const resolved = await runtime.getAuth('openai-codex', signal === undefined ? {} : { signal })
    const token = resolved?.auth.apiKey
    if (typeof token !== 'string' || token === '') throw new Error('The image model is not signed in. The service owner must run image-login and set AI_IMAGE_AUTH_PATH.')
    return token
  }
}
