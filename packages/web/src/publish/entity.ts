// The scene entity a Worlds deployment uploads, built the way `sdk-commands deploy`
// builds it (dcl-catalyst-client's DeploymentBuilder): the files the ignore rules
// leave, each named by its content hash, listed in an entity file whose own hash
// is the entity id the wallet signs.
import { LOCK_FILE, publishableFiles } from '@dcl-editor/web-build'
import { contentCid } from '@dcl-editor/contract/cid'
import { type RawSceneJson, parseSceneJson } from '../shell/scene-json'
import { PublishError } from './errors'

// sdk-commands' limit on one file of a deployment
const MAX_FILE_BYTES = 50_000_000
const PARCEL = /^-?\d+,-?\d+$/

export interface DeploymentEntity {
  version: 'v3'
  type: 'scene'
  pointers: string[]
  timestamp: number
  content: { file: string; hash: string }[]
  metadata: Record<string, unknown>
}

export interface Deployment {
  entityId: string
  entity: DeploymentEntity
  // every part of the upload by its hash, the entity file included
  files: Map<string, Uint8Array>
  title: string
  // what the scene deploys: its content files and their bytes
  fileCount: number
  bytes: number
}

const invalid = (message: string): PublishError => new PublishError('invalid-scene', message)

// The files a deployment carries: the project's and the build's, minus what
// .dclignore and sdk-commands' own rules leave out, and minus the package lock.
function deployableFiles(
  files: ReadonlyMap<string, Uint8Array>,
  outputs: ReadonlyMap<string, Uint8Array>
): Map<string, Uint8Array> {
  const all = new Map([...files, ...outputs])
  const dclignore = files.get('.dclignore')
  const kept = publishableFiles(all.keys(), dclignore === undefined ? undefined : new TextDecoder().decode(dclignore))
  const out = new Map<string, Uint8Array>()
  for (const path of kept.sort()) {
    const bytes = all.get(path)
    if (bytes !== undefined && path !== LOCK_FILE) out.set(path, bytes)
  }
  return out
}

function connected(parcels: string[]): boolean {
  const left = new Set(parcels)
  const queue = [parcels[0]]
  left.delete(parcels[0])
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    const [x, y] = at.split(',').map(Number)
    for (const next of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
      if (left.delete(next)) queue.push(next)
    }
  }
  return left.size === 0
}

// What sdk-commands checks before a deploy and the server right after it, said
// before the wallet is asked to sign anything.
function checkScene(scene: RawSceneJson, content: ReadonlyMap<string, Uint8Array>): string[] {
  const parcels = scene.scene?.parcels
  const base = scene.scene?.base
  if (!Array.isArray(parcels) || parcels.length === 0 || typeof base !== 'string') {
    throw invalid('This scene has no parcels. Set them in Scene settings.')
  }
  if (parcels.some((parcel) => typeof parcel !== 'string' || !PARCEL.test(parcel))) {
    throw invalid('A parcel of this scene is not written as "x,y". Fix it in Scene settings.')
  }
  if (new Set(parcels).size !== parcels.length) throw invalid('A parcel is listed twice in this scene. Fix it in Scene settings.')
  if (!parcels.includes(base)) throw invalid(`The base parcel ${base} is not one of the scene's parcels. Fix it in Scene settings.`)
  if (!connected(parcels)) throw invalid("The scene's parcels are not next to each other. Fix them in Scene settings.")
  const main = scene.main
  if (typeof main !== 'string' || !main.endsWith('.js')) throw invalid('scene.json has no "main" script to run.')
  if (!content.has(main)) throw invalid(`The build did not produce ${main}, the script scene.json names.`)
  const thumbnail = scene.display?.navmapThumbnail
  if (typeof thumbnail === 'string' && thumbnail !== '' && !content.has(thumbnail)) {
    throw invalid(`The scene thumbnail “${thumbnail}” is not one of the files being published. Choose it again in Scene settings.`)
  }
  const seen = new Map<string, string>()
  for (const [path, bytes] of content) {
    const other = seen.get(path.toLowerCase())
    if (other !== undefined) throw invalid(`“${other}” and “${path}” differ only in capitals. A scene cannot hold both: rename one.`)
    seen.set(path.toLowerCase(), path)
    if (bytes.length > MAX_FILE_BYTES) throw invalid(`“${path}” is larger than 50 MB, the most one file of a scene can be.`)
  }
  return parcels
}

export async function buildDeployment(input: {
  // the project's files as they are now, scene.json already naming the world
  files: ReadonlyMap<string, Uint8Array>
  // the production build: bin/index.js and, with a composite, main.crdt
  outputs: ReadonlyMap<string, Uint8Array>
  world: string
  sdkVersion: string
  timestamp: number
}): Promise<Deployment> {
  const scene = parseSceneJson(input.files.get('scene.json'))
  if (scene === null) throw invalid('scene.json is missing or is not valid JSON.')
  if (scene.worldConfiguration?.name !== input.world) throw invalid(`scene.json does not name ${input.world} as its world.`)
  const content = deployableFiles(input.files, input.outputs)
  const pointers = checkScene(scene, content)
  // the version the build used, never one an imported scene.json claims
  const { sdkVersion: _claimed, ...described } = scene

  const files = new Map<string, Uint8Array>()
  const list: { file: string; hash: string }[] = []
  for (const [path, bytes] of content) {
    const id = await contentCid(bytes)
    list.push({ file: path, hash: id })
    files.set(id, bytes)
  }
  let bytes = 0
  for (const file of files.values()) bytes += file.length

  // the key order DeploymentBuilder writes: the server hashes these exact bytes
  const entity: DeploymentEntity = {
    version: 'v3',
    type: 'scene',
    pointers,
    timestamp: input.timestamp,
    content: list,
    metadata: { sdkVersion: input.sdkVersion, ...described }
  }
  const entityFile = new TextEncoder().encode(JSON.stringify(entity))
  const entityId = await contentCid(entityFile)
  files.set(entityId, entityFile)
  return {
    entityId,
    entity,
    files,
    title: scene.display?.title?.trim() || input.world,
    fileCount: list.length,
    bytes
  }
}
