// Writes a built project into the Cache Storage store the service worker
// serves the preview realm from.
import { type PreviewEntity, type SceneJson, buildPreviewEntity, publishableFiles } from './preview-entity'
import { PROJECT_ID_PATTERN, contentVersion, plainBytes } from './preview-ids'
import type { ProjectFiles } from './build-events'
import { isRecord } from './vfs'

export const PREVIEW_CACHE_NAME = 'dcl-editor-preview-v1'
// the service worker keeps a preview's storage here, one `<realm>__storage` document per realm
export const PREVIEW_STORAGE_CACHE_NAME = 'dcl-editor-storage-v1'

export interface PreviewManifest {
  // bumped on every publish of the realm
  version: number
  entity: PreviewEntity
}

export interface PublishPreviewInput {
  // <PAGE_DIR>preview/<projectId>/
  realmUrl: string
  projectId: string
  files: ProjectFiles
  // bin/index.js and main.crdt; win over a same-named project file
  buildOutputs: ProjectFiles
  sceneJson: SceneJson
  sdkVersion?: string
  // unique per creator ([A-Za-z0-9_.]); the engine keys the scene's room on the entity id
  machineId?: string
}

export function previewRealmUrl(pageDir: string | URL, projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`Invalid preview project id "${projectId}"`)
  return new URL(`preview/${projectId}/`, pageDir).href
}

export const previewManifestUrl = (realmUrl: string): string => realmUrl + '__manifest'
export const previewContentUrl = (realmUrl: string, hash: string): string => `${realmUrl}content/contents/${hash}`

// Always with the id: a bare "/reload" respawns every scene, the HUD's included.
export const reloadCommand = (entityId: string): string => `/reload ${entityId}`

export async function publishPreview(input: PublishPreviewInput): Promise<{ realmUrl: string; entityId: string }> {
  const realmUrl = new URL(input.realmUrl).href
  if (realmUrl !== previewRealmUrl(new URL('../../', realmUrl), input.projectId)) {
    throw new Error(`"${input.realmUrl}" is not the preview realm of project "${input.projectId}"`)
  }
  const all = new Map([...input.files, ...input.buildOutputs])
  const dclignore = all.get('.dclignore')
  const paths = publishableFiles(all.keys(), dclignore === undefined ? undefined : new TextDecoder().decode(dclignore))
  const files = await Promise.all(
    paths.map(async (path) => {
      const bytes = all.get(path) ?? new Uint8Array()
      return { path, bytes, version: await contentVersion(bytes) }
    })
  )

  const cache = await caches.open(PREVIEW_CACHE_NAME)
  const previous = await cache.match(previewManifestUrl(realmUrl))
  const stored: unknown = await previous?.json().catch(() => undefined)
  const previousVersion = isRecord(stored) && typeof stored.version === 'number' ? stored.version : 0
  const entity = buildPreviewEntity({
    projectId: input.projectId,
    sceneJson: input.sceneJson,
    files,
    timestamp: Date.now(),
    sdkVersion: input.sdkVersion,
    machineId: input.machineId
  })

  // contents first, manifest last: a reader never sees an entity whose bytes are missing
  const live = new Set<string>()
  await Promise.all(
    entity.content.map(async ({ hash }, index) => {
      const url = previewContentUrl(realmUrl, hash)
      live.add(new URL(url).href)
      if ((await cache.match(url)) !== undefined) return
      await cache.put(url, new Response(plainBytes(files[index].bytes), { headers: { 'Content-Type': 'application/octet-stream' } }))
    })
  )
  const manifest: PreviewManifest = { version: previousVersion + 1, entity }
  await cache.put(
    previewManifestUrl(realmUrl),
    new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
  )
  const contentsPrefix = previewContentUrl(realmUrl, '')
  for (const request of await cache.keys()) {
    if (request.url.startsWith(contentsPrefix) && !live.has(request.url)) await cache.delete(request)
  }
  return { realmUrl, entityId: entity.id }
}
