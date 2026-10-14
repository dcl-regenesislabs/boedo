import { parseArgs } from 'node:util'
import { oauthLogin } from './oauth-login.ts'

const { values } = parseArgs({ options: { out: { type: 'string' } } })
if (!values.out) {
  console.error('usage: npm run -w @dcl-editor/service image-login -- --out <path/to/image-auth.json>')
  process.exit(2)
}

// the ChatGPT (Codex) sign-in the image model runs on, kept apart from the chat model's session
if (await oauthLogin('openai-codex', values.out)) {
  console.log(`ChatGPT session saved to ${values.out}. Copy it to the server outside STORAGE_DIR and set AI_IMAGE_AUTH_PATH to it.`)
} else process.exitCode = 1
