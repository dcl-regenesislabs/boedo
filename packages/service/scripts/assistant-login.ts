import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

const { values } = parseArgs({ options: { provider: { type: 'string' }, auth: { type: 'string' } } })
if (!values.auth || (values.provider !== 'claude' && values.provider !== 'codex')) {
  console.error('usage: node packages/service/scripts/assistant-login.ts --provider claude|codex --auth <path/to/.auth.json>')
  process.exit(2)
}

const input = createInterface({ input: process.stdin, output: process.stdout })
const controller = new AbortController()
input.on('SIGINT', () => controller.abort())
try {
  const runtime = await ModelRuntime.create({ authPath: values.auth, modelsPath: null, refreshOnCreate: false })
  await runtime.login(values.provider === 'claude' ? 'anthropic' : 'openai-codex', 'oauth', {
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
  console.log('OAuth session saved. Start the service with --ai-auth pointing to the same file.')
} catch {
  console.error('OAuth sign-in did not complete. Run the command again to retry.')
  process.exitCode = 1
} finally {
  input.close()
}
