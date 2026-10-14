import { execFile } from 'node:child_process'
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
        // the first option is the browser sign-in, which finishes through the local callback
        if (prompt.type === 'select') return prompt.options[0].id
        const signal = prompt.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, prompt.signal])
        // without a terminal (e.g. a `!` command) a closed stdin would cancel the browser callback, so only wait for it
        if (!process.stdin.isTTY) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
        return input.question(`${prompt.message}\n> `, { signal })
      },
      notify: (event) => {
        if (event.type === 'auth_url') {
          console.log(`Open this URL to sign in if no browser window opens:\n${event.url}`)
          if (process.platform === 'darwin') execFile('open', [event.url], () => {})
        }
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
