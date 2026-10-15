import { fromNativeResponse, Router } from '@dcl/http-server'
import { createMobilePreviewHandler } from '@dcl-regenesislabs/mobile-preview-runtime/server'
import type { GlobalContext } from '../types.ts'

export async function setupRouter({ components }: GlobalContext): Promise<Router<GlobalContext>> {
  const base = (await components.config.getString('BASE_PATH') ?? '').replace(/\/$/, '')
  const router = new Router<GlobalContext>()
  const mobile = createMobilePreviewHandler(undefined, `${base}/mobile-preview/`)
  router.all(`${base}/mobile-preview/:path(.*)`, async ({ request }) => fromNativeResponse(await mobile(request)))
  router.get(`${base}/assistant/socket`, async ({ request, components }) => components.assistant.upgrade(request))
  const paths = [
    '/health', '/projects', '/projects/:id', '/projects/:id/manifest',
    '/projects/:id/uploads', '/projects/:id/restore', '/projects/:id/files/:hash',
    '/prefabs', '/prefabs/:name', '/prefabs/:name/manifest', '/prefabs/:name/uploads', '/prefabs/:name/files/:hash',
    '/blobs/:hash', '/assistant/:action', '/:path(.*)'
  ]
  for (const path of paths) {
    router.all(base + path, async ({ request, components }) => fromNativeResponse(await components.projectStorage.handle(request)))
  }
  return router
}
