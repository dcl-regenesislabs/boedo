import { parseArgs } from 'node:util'
import { oauthLogin } from './oauth-login.ts'

const { values } = parseArgs({ options: { provider: { type: 'string' }, auth: { type: 'string' } } })
if (!values.auth || (values.provider !== 'claude' && values.provider !== 'codex')) {
  console.error('usage: node packages/service/scripts/assistant-login.ts --provider claude|codex --auth <path/to/.auth.json>')
  process.exit(2)
}

if (await oauthLogin(values.provider === 'claude' ? 'anthropic' : 'openai-codex', values.auth)) {
  console.log('OAuth session saved. Start the service with --ai-auth pointing to the same file.')
} else process.exitCode = 1
