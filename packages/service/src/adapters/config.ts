import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { composeConfigProviders, createConfigComponent, createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import type { IConfigComponent } from '@well-known-components/interfaces'
import type { Vars } from '../config.ts'

export async function createServiceConfig(overrides: Vars = {}): Promise<IConfigComponent> {
  const path = fileURLToPath(new URL('../../.env', import.meta.url))
  const environment = existsSync(path)
    ? await createDotEnvConfigComponent({ path })
    : createConfigComponent(process.env)
  return composeConfigProviders(
    createConfigComponent(overrides),
    environment,
    createConfigComponent({
      HTTP_SERVER_HOST: '127.0.0.1',
      HTTP_SERVER_PORT: '8787',
      ...(process.env.NODE_ENV === 'production' ? {} : { TICKET_SECRET: randomBytes(32).toString('hex') })
    })
  )
}
