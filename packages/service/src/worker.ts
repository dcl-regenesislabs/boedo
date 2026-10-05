// Cloudflare Workers entry. Not run in this repository: see README.md, "Deploying".
import { envFromVars } from './config.ts'
import type { Vars } from './config.ts'
import { handle } from './handler.ts'
import { purge } from './purge.ts'
import { createR2Store } from './r2-store.ts'
import type { R2BucketLike } from './r2-store.ts'

interface Bindings {
  BUCKET: R2BucketLike
  [name: string]: string | R2BucketLike | undefined
}

function env(bindings: Bindings) {
  const vars: Vars = {}
  for (const [name, value] of Object.entries(bindings)) if (typeof value === 'string' || value === undefined) vars[name] = value
  return envFromVars(vars, createR2Store(bindings.BUCKET))
}

export default {
  fetch: (request: Request, bindings: Bindings): Promise<Response> => {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
    if (bindings.LOCAL_WORKER_EMULATION !== 'true' || !local) return Promise.resolve(Response.json(
      { error: 'worker-production-unsupported' }, { status: 503, headers: { 'cache-control': 'no-store' } }
    ))
    return handle(request, env(bindings))
  },
  scheduled: (_event: unknown, bindings: Bindings, context: { waitUntil(work: Promise<unknown>): void }): void => {
    if (bindings.LOCAL_WORKER_EMULATION === 'true') context.waitUntil(purge(env(bindings)))
  }
}
