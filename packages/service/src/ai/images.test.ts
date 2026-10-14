import { describe, expect, it, vi } from 'vitest'
import { createCodexImageProvider } from './images.ts'

const claims = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-synthetic' } })).toString('base64url')
const token = `e30.${claims}.synthetic-signature`
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD'

function sse(events: unknown[]): Response {
  const text = events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('')
  const bytes = new TextEncoder().encode(text)
  // split mid-event so the parser has to join chunks
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 40))
      controller.enqueue(bytes.slice(40))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('the Codex image provider', () => {
  it('asks the ChatGPT responses backend for one landscape image from the brief and reference shots', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => sse([
      { type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: jpeg } },
      { type: 'response.completed', response: { status: 'completed', output: [] } }
    ]))
    const provider = createCodexImageProvider({ token: async () => token, fetch })
    const image = await provider.generate({ prompt: 'Key art', references: [{ mimeType: 'image/jpeg', data: 'AAAA' }] })

    expect(image).toEqual({ mimeType: 'image/jpeg', data: jpeg })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${token}`, 'chatgpt-account-id': 'acct-synthetic', accept: 'text/event-stream' })
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      store: false, stream: true,
      tools: [{ type: 'image_generation', size: '1536x1024' }],
      tool_choice: { type: 'image_generation' },
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Key art' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' }] }]
    })
  })

  it('takes the image from the completed response and reports a failed one', async () => {
    const done = createCodexImageProvider({ token: async () => token, fetch: async () => sse([
      { type: 'response.completed', response: { output: [{ type: 'message' }, { type: 'image_generation_call', result: jpeg }] } }
    ]) })
    await expect(done.generate({ prompt: 'x', references: [] })).resolves.toEqual({ mimeType: 'image/jpeg', data: jpeg })

    const failed = createCodexImageProvider({ token: async () => token, fetch: async () => sse([
      { type: 'response.failed', response: { error: { message: 'moderation_blocked' } } }
    ]) })
    await expect(failed.generate({ prompt: 'x', references: [] })).rejects.toThrow('moderation_blocked')

    const empty = createCodexImageProvider({ token: async () => token, fetch: async () => sse([{ type: 'response.completed', response: { output: [] } }]) })
    await expect(empty.generate({ prompt: 'x', references: [] })).rejects.toThrow('without an image')

    const limited = createCodexImageProvider({ token: async () => token, fetch: async () => new Response('{"error":{"code":"usage_limit_reached"}}', { status: 429 }) })
    await expect(limited.generate({ prompt: 'x', references: [] })).rejects.toThrow('usage limit')
  })
})
