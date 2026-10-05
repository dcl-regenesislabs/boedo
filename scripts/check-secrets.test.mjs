import { expect, it } from 'vitest'
import { secretFindings } from './check-secrets.mjs'

it('reports credential filenames without reading their content', () => {
  expect(secretFindings('packages/service/.env.production')).toEqual([{ path: 'packages/service/.env.production', rule: 'credential-file' }])
  expect(secretFindings('.auth.json')).toHaveLength(1)
})

it('reports the location of credentials without returning the value', () => {
  const token = ['sk', 'ant', 'oat01', 'x'.repeat(40)].join('-')
  const result = secretFindings('config.ts', '\nconst token = "' + token + '"')
  expect(result).toEqual([{ path: 'config.ts', rule: 'anthropic-token', line: 2 }])
  expect(JSON.stringify(result)).not.toContain(token)
  expect(secretFindings('README.md', 'ANTHROPIC_OAUTH_SETUP_TOKEN=<your token>')).toEqual([])
})
