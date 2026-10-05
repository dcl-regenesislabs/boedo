// A stand-in for the Worlds content server, in memory, for tests and the gate:
//
//   node packages/web/validate/fake-worlds-server.mjs --port 8799 --world my.dcl.eth=0x<owner>
//
// `POST /entities` checks a deployment the way the real server does (its
// validations, in its order, with its sentences) and the world is then served
// the way an explorer loads one: /world/<name>/about and /contents/<hash>.
// Names are not on a chain here: `--world name=0x<owner>` says who owns one,
// `--allow name=0x<wallet>` adds a wallet to its deployment list, and
// `--claim name` leaves it to the first wallet that deploys to it.
// The world's comms are offline: one visitor at a time.
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { Authenticator } from '@dcl/crypto'
import { hashV1 } from '@dcl/hashing'

const MB = 1024 * 1024
const MAX_ENTITY_FILE_BYTES = 5 * MB
const MAX_UPLOAD_BYTES = 350 * MB
const FUTURE_SKEW_MS = 15 * 60 * 1000
const CID = /^baf(krei|ybei)[a-z2-7]{52}$/
const ADDRESS = /^0x[a-fA-F0-9]{40}$/
const PARCEL = /^-?\d+,-?\d+$/

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,OPTIONS,DELETE,POST,PUT',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400'
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
const refuse = (message) => json(400, { error: 'Bad request', message })
const failed = (errors) => refuse(`Deployment failed: ${errors.join(', ')}`)

function authChainOf(form) {
  let last = -1
  for (const key of form.keys()) {
    const match = /^authChain\[(\d+)]/.exec(key)
    if (match) last = Math.max(last, Number(match[1]))
  }
  if (last === -1) return null
  const chain = []
  for (let i = 0; i <= last; i++) {
    const link = { payload: form.get(`authChain[${i}][payload]`), signature: form.get(`authChain[${i}][signature]`), type: form.get(`authChain[${i}][type]`) }
    if (typeof link.payload !== 'string' || typeof link.signature !== 'string' || typeof link.type !== 'string') return null
    chain.push(link)
  }
  return chain
}

// options.worlds: { [name]: { owner?: '0x…', deployers?: ['0x…'] } }; a world with no owner goes to its first deployer
export function createFakeWorlds(options = {}) {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? 300_000
  const maxBytes = options.maxBytes ?? 100 * MB
  const maxParcels = options.maxParcels ?? 4
  const content = new Map()
  const worlds = new Map()
  const log = []
  for (const [name, seed] of Object.entries(options.worlds ?? {})) {
    worlds.set(name.toLowerCase(), {
      owner: seed.owner?.toLowerCase() ?? null,
      deployers: new Set((seed.deployers ?? []).map((wallet) => wallet.toLowerCase())),
      scenes: []
    })
  }

  const live = (name) => worlds.get(name.toLowerCase())
  const canDeploy = (world, wallet) => world.owner === null || world.owner === wallet || world.deployers.has(wallet)

  async function deploy(request, origin) {
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_UPLOAD_BYTES) return refuse('The multipart request is too large.')
    let form
    try {
      form = await request.formData()
    } catch {
      return refuse('The request is not multipart/form-data.')
    }
    const entityId = form.get('entityId')
    if (typeof entityId !== 'string') return refuse('A string was expected')
    const authChain = authChainOf(form)
    if (authChain === null) return refuse('Missing auth chain')
    const uploaded = new Map()
    for (const [key, value] of form) {
      if (typeof value !== 'string') uploaded.set(key, new Uint8Array(await value.arrayBuffer()))
    }
    const entityFile = uploaded.get(entityId)
    if (entityFile === undefined) return refuse(`Entity file "${entityId}" is missing from the request.`)
    if (entityFile.length > MAX_ENTITY_FILE_BYTES) {
      return refuse(`The entity file is too large. The maximum allowed size is ${MAX_ENTITY_FILE_BYTES} bytes.`)
    }
    let entity
    try {
      entity = { ...JSON.parse(new TextDecoder().decode(entityFile)), id: entityId }
    } catch {
      return refuse('The entity file is not valid JSON.')
    }

    // before storage, in the real server's order
    for (const [key, ok] of [
      ['version', typeof entity.version === 'string'],
      ['type', typeof entity.type === 'string'],
      ['pointers', Array.isArray(entity.pointers) && entity.pointers.every((pointer) => typeof pointer === 'string')],
      ['timestamp', typeof entity.timestamp === 'number'],
      ['content', Array.isArray(entity.content) && entity.content.every((item) => typeof item?.file === 'string' && typeof item.hash === 'string')]
    ]) {
      if (!ok) return failed([`must have required property '${key}'`])
    }
    if (entity.type !== 'scene') return failed([`Entity type ${entity.type} is not supported.`])
    if (entity.content.length > 10000) {
      return failed([`The deployment has too many files. The maximum allowed is 10000 but the deployment has ${entity.content.length}.`])
    }
    const signer = authChain[0].payload
    if (!ADDRESS.test(signer)) return failed([`Invalid signer: ${signer}`])
    const age = now() - entity.timestamp
    if (age < -FUTURE_SKEW_MS) {
      return failed([`Deployment was created ${Math.abs(age) / 1000} secs in the future. Max allowed: ${FUTURE_SKEW_MS / 1000} secs.`])
    }
    if (age > ttlMs) return failed([`Deployment was created ${age / 1000} secs ago. Max allowed: ${ttlMs / 1000} secs.`])
    const actual = await hashV1(entityFile)
    if (actual !== entityId) return failed([`Invalid entity hash: expected ${actual} but got ${entityId}`])
    const signature = await Authenticator.validateSignature(entityId, authChain, null, now())
    if (!signature.ok) return failed([signature.message ?? 'Invalid signature'])

    const metadata = entity.metadata
    if (typeof metadata !== 'object' || metadata === null) return failed(["must have required property 'main'"])
    if (typeof metadata.main !== 'string') return failed(["must have required property 'main'"])
    const scene = metadata.scene
    if (typeof scene !== 'object' || scene === null) return failed(["must have required property 'scene'"])
    const name = metadata.worldConfiguration?.name
    if (typeof name !== 'string' || name === '') {
      return failed(['scene.json needs to specify a worldConfiguration section with a valid name inside.'])
    }
    if (metadata.worldConfiguration.dclName) {
      return failed(['`dclName` in scene.json was renamed to `name`. Please update your scene.json accordingly.'])
    }
    const parcels = scene.parcels
    const canonical = (list) => Array.isArray(list) && list.length > 0 && list.every((p) => typeof p === 'string' && PARCEL.test(p)) && new Set(list).size === list.length
    if (canonical(parcels) && !parcels.includes(scene.base)) {
      return failed([`The scene base parcel [${scene.base ?? ''}] must be included in the scene parcels [${parcels.join(', ')}].`])
    }
    if (!canonical(parcels) || !canonical(entity.pointers)) {
      return failed(['Scene pointers and parcels must be unique canonical parcel coordinates.'])
    }
    if (entity.pointers.length !== parcels.length || !entity.pointers.every((pointer) => parcels.includes(pointer))) {
      return failed([`The scene pointers [${entity.pointers.join(', ')}] must match the scene parcels [${parcels.join(', ')}].`])
    }
    if (parcels.length > maxParcels) return failed([`Max allowed scene dimensions is ${maxParcels} parcels.`])
    const world = live(name)
    const wallet = signer.toLowerCase()
    if (world === undefined || !canDeploy(world, wallet)) {
      return failed([
        `Deployment failed: Your wallet has no permission to publish this scene because it does not have permission to deploy under "${name}". Check scene.json to select a name that either you own or you were given permission to deploy.`
      ])
    }
    const listed = (file) => entity.content.some((item) => item.file === file)
    const thumbnail = metadata.display?.navmapThumbnail
    if (thumbnail) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(thumbnail) || thumbnail.startsWith('/') || thumbnail !== thumbnail.trim() || /[<>"]/.test(thumbnail)) {
        return failed([`Scene thumbnail '${thumbnail}' must be a relative path to a file included in the deployment.`])
      }
      if (!listed(thumbnail)) return failed([`Scene thumbnail '${thumbnail}' must be a file included in the deployment.`])
    }

    // after storage
    const errors = []
    const wanted = new Set(entity.content.map((item) => item.hash))
    for (const [hash, bytes] of uploaded) {
      if (!wanted.has(hash) && hash !== entityId) errors.push(`Extra file detected ${hash}`)
      if (!CID.test(hash)) errors.push(`Only CIDv1 are allowed for content files: ${hash}`)
      if ((await hashV1(bytes)) !== hash) errors.push(`The hashed file doesn't match the provided content: ${hash}`)
    }
    for (const item of entity.content) {
      if (!uploaded.has(item.hash) && !content.has(item.hash)) {
        errors.push(`The file ${item.hash} (${item.file}) is neither present in the storage or in the provided entity`)
      }
    }
    if (errors.length > 0) return failed(errors)
    let size = 0
    for (const hash of wanted) size += (uploaded.get(hash) ?? content.get(hash)).length
    if (size > maxBytes) {
      return failed([
        `The deployment is too big. The maximum total size allowed is ${maxBytes} bytes for scenes. You can upload up to ${maxBytes} bytes but you tried to upload ${size}.`
      ])
    }

    for (const [hash, bytes] of uploaded) content.set(hash, bytes)
    if (world.owner === null) world.owner = wallet
    // a scene replaces the ones standing on its parcels, and no others
    world.scenes = world.scenes.filter((other) => !other.parcels.some((parcel) => parcels.includes(parcel)))
    const at = new Date(now()).toISOString()
    world.scenes.push({ entity, authChain, deployer: wallet, parcels: [...parcels], size, createdAt: at })
    const worldUrl = `${origin}/world/${name}`
    return json(200, {
      creationTimestamp: now(),
      message: [
        `Your scene was deployed to World "${name}" at parcels: ${parcels.join(', ')}!`,
        `Access world: https://play.decentraland.org/?realm=${encodeURIComponent(worldUrl)}&position=${encodeURIComponent(parcels[0])}`
      ].join('\n')
    })
  }

  function about(name, origin) {
    const world = live(name)
    if (world === undefined || world.scenes.length === 0) {
      return json(404, { error: 'Not Found', message: `World "${name}" has no scenes deployed.` })
    }
    const first = world.scenes[0].entity.metadata
    return json(200, {
      healthy: true,
      acceptingUsers: true,
      spawnCoordinates: first.scene.base,
      configurations: {
        networkId: 1,
        globalScenesUrn: [],
        scenesUrn: world.scenes.map((scene) => `urn:decentraland:entity:${scene.entity.id}?=&baseUrl=${origin}/contents/`),
        minimap: { enabled: false },
        skybox: { textures: [] },
        realmName: first.worldConfiguration.name,
        map: { minimapEnabled: false, sizes: [] }
      },
      content: { synchronizationStatus: 'Syncing', healthy: true, publicUrl: 'https://peer.decentraland.org/content' },
      lambdas: { healthy: true, publicUrl: 'https://peer.decentraland.org/lambdas' },
      comms: { healthy: true, protocol: 'v3', adapter: 'fixed-adapter:offline:offline' }
    })
  }

  const sceneRow = (name, scene) => ({
    worldName: name,
    deployer: scene.deployer,
    entityId: scene.entity.id,
    deploymentAuthChain: scene.authChain,
    entity: scene.entity,
    parcels: scene.parcels,
    size: String(scene.size),
    status: 'DEPLOYED',
    createdAt: scene.createdAt,
    updatedAt: scene.createdAt
  })

  function file(hash, head) {
    if (!CID.test(hash) && !/^[0-9a-f]{64}$/.test(hash)) return new Response(null, { status: 400, headers: CORS })
    const bytes = content.get(hash)
    if (bytes === undefined) return new Response(null, { status: 404, headers: CORS })
    return new Response(head ? null : bytes, {
      status: 200,
      headers: {
        ...CORS,
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
        etag: JSON.stringify(hash),
        'access-control-expose-headers': 'ETag, Accept-Ranges, Content-Range',
        'cache-control': 'public,max-age=31536000,s-maxage=31536000,immutable'
      }
    })
  }

  async function route(request, origin) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = request.method
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (method === 'POST' && path === '/entities') return deploy(request, origin)
    if (method === 'POST' && path === '/entities/active') {
      const body = await request.json().catch(() => null)
      if (!Array.isArray(body?.pointers)) return refuse('Invalid request. Request body is not valid')
      return json(200, body.pointers.flatMap((pointer) => (typeof pointer === 'string' ? (live(pointer)?.scenes ?? []) : [])).map((scene) => scene.entity))
    }
    if (method === 'GET' && path === '/available-content') {
      const cids = url.searchParams.getAll('cid')
      if (cids.length === 0) return refuse('At least one cid query parameter is required.')
      if (cids.length > 500) return refuse('Too many cid query parameters. Maximum allowed is 500.')
      if (!cids.every((cid) => CID.test(cid))) return refuse('Invalid cid format.')
      return json(200, cids.map((cid) => ({ cid, available: content.has(cid) })))
    }
    const hashed = /^\/(?:contents|ipfs)\/([^/]+)$/.exec(path)
    if (hashed && (method === 'GET' || method === 'HEAD')) return file(hashed[1], method === 'HEAD')
    if (method === 'GET' && path === '/worlds') {
      const wallet = url.searchParams.get('authorized_deployer')?.toLowerCase()
      if (wallet !== undefined && !ADDRESS.test(wallet)) {
        return refuse(`Invalid authorized_deployer address: ${wallet}. Must be a valid Ethereum address.`)
      }
      const rows = [...worlds]
        .filter(([, world]) => wallet === undefined || canDeploy(world, wallet))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, world]) => ({
          name,
          // an unclaimed world is listed as the asking wallet's own
          owner: world.owner ?? wallet ?? null,
          title: world.scenes[0]?.entity.metadata.display?.title ?? null,
          description: null,
          shape: null,
          content_rating: null,
          spawn_coordinates: world.scenes[0]?.entity.metadata.scene.base ?? null,
          skybox_time: null,
          categories: null,
          single_player: false,
          show_in_places: true,
          thumbnail_hash: null,
          last_deployed_at: world.scenes.at(-1)?.createdAt ?? null,
          blocked_since: null,
          deployed_scenes: world.scenes.length
        }))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 100)
      return json(200, { worlds: rows.slice(offset, offset + limit), total: rows.length })
    }
    const stats = /^\/wallet\/([^/]+)\/stats$/.exec(path)
    if (method === 'GET' && stats) {
      const wallet = stats[1].toLowerCase()
      if (!ADDRESS.test(wallet)) return refuse('Invalid request. Missing or invalid wallet in request url param.')
      const owned = [...worlds].filter(([, world]) => world.owner === wallet)
      const sizes = owned.map(([name, world]) => ({ name, size: String(world.scenes.reduce((sum, scene) => sum + scene.size, 0)) }))
      return json(200, {
        wallet,
        dclNames: sizes,
        ensNames: [],
        usedSpace: String(sizes.reduce((sum, world) => sum + Number(world.size), 0)),
        maxAllowedSpace: String(maxBytes)
      })
    }
    const inWorld = /^\/world\/([^/]+)\/([a-z]+)$/.exec(path)
    if (inWorld) {
      const name = decodeURIComponent(inWorld[1]).toLowerCase()
      const world = live(name)
      if (method === 'GET' && inWorld[2] === 'about') return about(name, origin)
      if (inWorld[2] === 'scenes' && (method === 'GET' || method === 'POST')) {
        const asked = method === 'POST' ? (await request.json().catch(() => null))?.coordinates : undefined
        const scenes = (world?.scenes ?? []).filter((scene) => !Array.isArray(asked) || scene.parcels.some((parcel) => asked.includes(parcel)))
        return json(200, { scenes: scenes.map((scene) => sceneRow(name, scene)), total: scenes.length })
      }
      if (method === 'GET' && inWorld[2] === 'permissions') {
        return json(200, {
          permissions: {
            // an unclaimed world takes its first deployer, whoever that is
            deployment: world !== undefined && world.owner === null ? { type: 'unrestricted' } : { type: 'allow-list', wallets: [...(world?.deployers ?? [])] },
            streaming: { type: 'allow-list', wallets: [] },
            access: { type: 'unrestricted' }
          },
          ...(world?.owner ? { owner: world.owner } : {}),
          summary: {}
        })
      }
      if (method === 'GET' && inWorld[2] === 'settings') {
        return json(404, { error: `World "${name}" not found or has no settings configured.` })
      }
    }
    if (method === 'GET' && path === '/status') {
      return json(200, { content: { commitHash: 'fake', worldsCount: { ens: 0, dcl: worlds.size } }, comms: { adapterType: 'offline' } })
    }
    return json(404, { error: 'Not Found', message: `${method} ${path}` })
  }

  return {
    log,
    // every stored content file, by hash
    content,
    // the entities a world serves now
    entities: (name) => (live(name)?.scenes ?? []).map((scene) => scene.entity),
    async handle(request, origin = new URL(request.url).origin) {
      const response = await route(request, origin)
      log.push(`${request.method} ${new URL(request.url).pathname} ${response.status}`)
      return response
    }
  }
}

function listen(port, worlds) {
  const fake = createFakeWorlds({ worlds })
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const origin = `http://${incoming.headers.host ?? `localhost:${port}`}`
      const withBody = incoming.method !== 'GET' && incoming.method !== 'HEAD'
      const response = await fake.handle(
        new Request(origin + (incoming.url ?? '/'), { method: incoming.method, headers: incoming.headers, body: withBody ? Buffer.concat(chunks) : undefined }),
        origin
      )
      console.log(fake.log.at(-1))
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error(error)
      outgoing.writeHead(500, CORS).end()
    }
  })
  server.listen(port, () => console.log(`fake Worlds content server on http://localhost:${port} (${Object.keys(worlds).join(', ') || 'no worlds'})`))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const values = (flag) => args.flatMap((arg, i) => (arg === flag && args[i + 1] !== undefined ? [args[i + 1]] : []))
  const worlds = {}
  const world = (name) => (worlds[name.toLowerCase()] ??= { deployers: [] })
  for (const seed of values('--world')) {
    const [name, owner] = seed.split('=')
    world(name).owner = owner
  }
  for (const seed of values('--allow')) {
    const [name, wallet] = seed.split('=')
    world(name).deployers.push(wallet)
  }
  for (const name of values('--claim')) world(name)
  listen(Number(values('--port')[0] ?? 8799), worlds)
}
