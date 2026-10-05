import type { Lifecycle } from '@well-known-components/interfaces'
import { fromNativeResponse, getUnderlyingServer } from '@dcl/http-server'
import type { Server } from 'node:http'
import { setupRouter } from './controllers/routes.ts'
import type { AppComponents, GlobalContext } from './types.ts'

export async function main({ components, startComponents }: Lifecycle.EntryPointParameters<AppComponents>): Promise<void> {
  const context: GlobalContext = { components }
  const router = await setupRouter(context)
  components.server.setContext(context)
  components.server.use(router.middleware())
  components.server.use(router.allowedMethods())
  components.server.use(async ({ request }) => fromNativeResponse(await components.projectStorage.handle(request)))
  await startComponents()
  const server = await getUnderlyingServer<Server>(components.server)
  server.maxConnections = 256
  server.headersTimeout = 10_000
  server.requestTimeout = 15 * 60_000
  server.keepAliveTimeout = 5000
}
