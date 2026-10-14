// The scene entity a preview realm serves, as sdk-commands' preview server builds it.
import ignore from 'ignore'
import { previewContentId, previewEntityId } from './preview-ids'
import { isRecord } from './vfs'

export interface PreviewEntity {
  version: 'v3'
  type: 'scene'
  id: string
  pointers: string[]
  timestamp: number
  content: { file: string; hash: string }[]
  metadata: Record<string, unknown>
}

export type SceneJson = Record<string, unknown>

// sdk-commands' default .dclignore, applied on top of the project's own
const DEFAULT_IGNORE = [
  '.*',
  'package.json',
  'package-lock.json',
  'yarn-lock.json',
  'build.json',
  'export',
  'tsconfig.json',
  'tslint.json',
  'node_modules',
  'dclcontext',
  '**/*.ts',
  '**/*.tsx',
  'Dockerfile',
  'thumbnails',
  'dist',
  'README.md',
  '*.blend',
  '*.fbx',
  '*.zip',
  '*.rar',
  '*.map',
  'node_modules/**',
  '*.md'
]

// the files a scene deploys: everything the ignore rules leave
export function publishableFiles(paths: Iterable<string>, dclignore?: string): string[] {
  const rules = ignore().add([...(dclignore?.split('\n') ?? []), ...DEFAULT_IGNORE].filter(Boolean))
  const visible = [...paths].filter((path) => !path.split('/').some((segment) => segment.startsWith('.')))
  return rules.filter(visible)
}

export function scenePointers(sceneJson: SceneJson): string[] {
  const scene = sceneJson.scene
  if (!isRecord(scene)) throw new Error('scene.json has no "scene" section')
  const { base, parcels } = scene
  if (typeof base !== 'string' || !Array.isArray(parcels)) throw new Error('scene.json needs scene.base and scene.parcels')
  return [...new Set([base, ...parcels.filter((parcel): parcel is string => typeof parcel === 'string')])]
}

export function buildPreviewEntity(input: {
  projectId: string
  sceneJson: SceneJson
  // publishable files with the version of their current bytes
  files: { path: string; version: string }[]
  timestamp: number
  sdkVersion?: string
  machineId?: string
}): PreviewEntity {
  const seen = new Set<string>()
  const content = input.files.map(({ path, version }) => {
    const file = path.toLowerCase()
    if (seen.has(file)) throw new Error(`Two files deploy as "${file}"; scene file names are case-insensitive`)
    seen.add(file)
    return { file, hash: previewContentId(input.projectId, path, version, input.machineId) }
  })
  return {
    version: 'v3',
    type: 'scene',
    id: previewEntityId(input.projectId, input.machineId),
    pointers: scenePointers(input.sceneJson),
    timestamp: input.timestamp,
    content,
    metadata: input.sdkVersion === undefined ? input.sceneJson : { sdkVersion: input.sdkVersion, ...input.sceneJson }
  }
}
