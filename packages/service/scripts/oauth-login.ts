import { createInterface } from 'node:readline/promises'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

/** Runs pi's OAuth sign-in for a provider and saves the session (mode 0600) at authPath. */
export async function oauthLogin(providerId: 'anthropic' | 'openai-codex', authPath: string): Promise<boolean> {
  const input = createInterface({ input: process.stdin, output: process.stdout })
  const controller = new AbortController()
  input.on('SIGINT', () => controller.abort())
  try {
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false })
    await runtime.login(providerId, 'oauth', {
      signal: controller.signal,
      prompt: async (prompt) => {
        if (prompt.type === 'secret') throw new Error('Only OAuth sign-in is supported.')
        if (prompt.type === 'select') for (const option of prompt.options) console.log(`${option.id}: ${option.label}`)
        const signal = prompt.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, prompt.signal])
        return input.question(`${prompt.message}\n> `, { signal })
      },
      notify: (event) => {
        if (event.type === 'auth_url') console.log(`${event.instructions ?? 'Open this URL to sign in:'}\n${event.url}`)
        else if (event.type === 'device_code') console.log(`Open ${event.verificationUri} and enter ${event.userCode}`)
        else console.log(event.message)
      }
    })
    return true
  } catch {
    console.error('OAuth sign-in did not complete. Run the command again to retry.')
    return false
  } finally {
    input.close()
  }
}
