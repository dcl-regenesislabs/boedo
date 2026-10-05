// The project-storage service in memory, written from the host contract (v1),
// for tests: the unit tests call handle() directly, the headless smoke mounts it
// on its http server. No imports: Node runs this file as it is.
//
// Where the contract is silent it answers as packages/service does: errors are
// codes, a deleted project has no manifest to read (404 "deleted") and refuses a
// new one (409 "deleted") until it is restored.

export interface FakeRequest {
  method: string
  // below the service's base url, e.g. "/projects/my-scene/manifest"
  path: string
  // the signer, as the real service reads it from the auth chain; null: unsigned
  wallet: string | null
  body?: Uint8Array
}

export interface FakeResponse {
  status: number
  json?: unknown
  bytes?: Uint8Array
}

interface StoredProject {
  name: string
  version: number
  updatedAt: number
  deletedAt?: number
  files: Record<string, { hash: string; size: number }>
}

export interface FakeService {
  handle(request: FakeRequest): Promise<FakeResponse>
  // every request answered, in order: "PUT /projects/a/manifest 200"
  readonly log: string[]
}

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const HASH = /^baf(krei|ybei)[a-z2-7]{52}$/
const UPLOAD_PATH = /^\/uploads\/([^/]+)\/([^/]+)$/
const PROJECT_PATH = /^\/projects\/([^/]+)(?:\/(manifest|uploads|restore|files\/([^/]+)))?$/

export function createFakeService(options: {
  hash: (bytes: Uint8Array) => Promise<string>
  // the absolute url of this service, for the upload urls it hands out
  baseUrl: string
  quotaBytes?: number
  now?: () => number
}): FakeService {
  const now = options.now ?? Date.now
  const wallets = new Map<string, { projects: Map<string, StoredProject>; blobs: Map<string, Uint8Array> }>()
  const log: string[] = []

  const account = (wallet: string): { projects: Map<string, StoredProject>; blobs: Map<string, Uint8Array> } => {
    const key = wallet.toLowerCase()
    let found = wallets.get(key)
    if (found === undefined) {
      found = { projects: new Map(), blobs: new Map() }
      wallets.set(key, found)
    }
    return found
  }
  const fail = (status: number, error: string, more: Record<string, unknown> = {}): FakeResponse => ({
    status,
    json: { error, ...more }
  })
  const parse = (body: Uint8Array | undefined): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(body))
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  async function answer(request: FakeRequest): Promise<FakeResponse> {
    const { method, path } = request
    const upload = UPLOAD_PATH.exec(path)
    // the upload url carries its own grant, as a presigned one does
    if (upload !== null && method === 'PUT') {
      const bytes = request.body ?? new Uint8Array()
      if ((await options.hash(bytes)) !== upload[2]) return fail(422, 'hash-mismatch')
      account(upload[1]).blobs.set(upload[2], bytes)
      return { status: 201, json: { hash: upload[2], size: bytes.length } }
    }
    if (request.wallet === null) return fail(401, 'unsigned')
    const mine = account(request.wallet)
    if (path === '/projects' && method === 'GET') {
      return {
        status: 200,
        json: {
          projects: [...mine.projects].map(([id, project]) => ({
            id,
            name: project.name,
            version: project.version,
            updatedAt: project.updatedAt,
            bytes: Object.values(project.files).reduce((sum, file) => sum + file.size, 0),
            ...(project.deletedAt === undefined ? {} : { deletedAt: project.deletedAt })
          }))
        }
      }
    }
    const match = PROJECT_PATH.exec(path)
    if (match === null) return fail(404, 'not-found')
    const [, id, action, hash] = match
    if (!PROJECT_ID.test(id)) return fail(400, 'invalid-project-id')
    const project = mine.projects.get(id)

    if (action === undefined && method === 'DELETE') {
      if (project === undefined) return fail(404, 'not-found')
      project.deletedAt ??= now()
      return { status: 200, json: {} }
    }
    if (action === 'restore' && method === 'POST') {
      if (project === undefined) return fail(404, 'not-found')
      delete project.deletedAt
      return { status: 200, json: {} }
    }
    if (action === 'manifest' && method === 'GET') {
      if (project === undefined) return fail(404, 'not-found')
      if (project.deletedAt !== undefined) return fail(404, 'deleted', { deletedAt: project.deletedAt })
      const { name, version, updatedAt, files } = project
      return { status: 200, json: { id, name, version, updatedAt, files } }
    }
    if (action === 'uploads' && method === 'POST') {
      const files = parse(request.body)?.files
      if (!Array.isArray(files)) return fail(400, 'invalid-files')
      const wanted = (files as Array<{ hash?: unknown }>).map((file) => file.hash)
      if (!wanted.every((value): value is string => typeof value === 'string' && HASH.test(value))) {
        return fail(400, 'invalid-hash')
      }
      return {
        status: 200,
        json: {
          uploads: [...new Set(wanted)]
            .filter((value) => !mine.blobs.has(value))
            .map((value) => ({
              hash: value,
              url: `${options.baseUrl}/uploads/${request.wallet?.toLowerCase()}/${value}`,
              method: 'PUT',
              headers: { 'content-type': 'application/octet-stream' }
            }))
        }
      }
    }
    if (action === 'manifest' && method === 'PUT') {
      const body = parse(request.body)
      const files = body?.files as StoredProject['files'] | undefined
      if (body === null || typeof body.name !== 'string' || typeof files !== 'object' || files === null) {
        return fail(400, 'invalid-files')
      }
      const stale = { version: project?.version, updatedAt: project?.updatedAt }
      if (project?.deletedAt !== undefined) return fail(409, 'deleted', { ...stale, deletedAt: project.deletedAt })
      if (project === undefined && body.baseVersion !== null) return fail(404, 'not-found')
      if (project !== undefined && body.baseVersion !== project.version) return fail(409, 'stale', stale)
      const missing = Object.values(files).filter((file) => !mine.blobs.has(file.hash))
      if (missing.length > 0) return fail(422, 'missing-blobs', { missing: missing.map((file) => file.hash) })
      const bytes = Object.values(files).reduce((sum, file) => sum + file.size, 0)
      if (options.quotaBytes !== undefined && bytes > options.quotaBytes) {
        return fail(413, 'quota-exceeded', { limit: options.quotaBytes })
      }
      const next: StoredProject = { name: body.name, version: (project?.version ?? 0) + 1, updatedAt: now(), files }
      mine.projects.set(id, next)
      return { status: 200, json: { version: next.version, updatedAt: next.updatedAt } }
    }
    if (hash !== undefined && method === 'GET') {
      const listed = project?.deletedAt === undefined && Object.values(project?.files ?? {}).some((file) => file.hash === hash)
      const bytes = listed ? mine.blobs.get(hash) : undefined
      return bytes === undefined ? fail(404, 'not-found') : { status: 200, bytes }
    }
    return fail(405, 'method-not-allowed')
  }

  return {
    log,
    async handle(request) {
      const response = await answer(request)
      log.push(`${request.method} ${request.path.replace(/\/uploads\/[^/]+\//, '/uploads/')} ${response.status}`)
      return response
    }
  }
}
