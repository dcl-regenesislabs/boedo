// Who still needs a project file, so deleting one can say what it would break.
import { object } from '@dcl-editor/contract'
import { state } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { dataLayerListFiles, dataLayerReadFile, dataLayerRemoveFiles, dataLayerWriteTick } from './engine/datalayer'
import { IGNORED_DIRS } from './script/project-files'

const SCRIPT = /^src\/.*\.(ts|tsx|js)$/
// a model the assistant built in code: models/<name>-<hash>.glb, its script models/src/<name>.js
const BUILT = /^models\/([a-z0-9-]+)-[0-9a-f]{8}\.glb$/

export async function fileUsers(path: string): Promise<{ entities: string[]; scripts: string[] }> {
  const entities = Object.entries(state.snapshot)
    .filter(([id, c]) => Number(id) >= 512 && object(c.GltfContainer) && c.GltfContainer.src === path)
    .map(([id]) => entityName(state.snapshot, id) ?? `#${id}`)
  const files = await dataLayerListFiles(IGNORED_DIRS)
  const scripts: string[] = []
  for (const file of files.filter((f) => SCRIPT.test(f))) {
    if ((await dataLayerReadFile(file).catch(() => '')).includes(path)) scripts.push(file)
  }
  return { entities, scripts }
}

const MODEL = /\.(glb|gltf)$/i

function placedModels(): Set<string> {
  return new Set(Object.values(state.snapshot).flatMap((c) => (object(c.GltfContainer) && typeof c.GltfContainer.src === 'string' ? [c.GltfContainer.src] : [])))
}

// Model files nothing uses: no entity places them and no script names them. An older build of a model
// still in the scene is kept for undo, so it is not one of them.
export async function unusedModelFiles(): Promise<string[]> {
  const files = await dataLayerListFiles(IGNORED_DIRS)
  const placed = placedModels()
  const building = new Set([...placed].flatMap((path) => BUILT.exec(path)?.[1] ?? []))
  const candidates = files.filter((f) => MODEL.test(f) && !placed.has(f) && !building.has(BUILT.exec(f)?.[1] ?? ''))
  if (candidates.length === 0) return []
  const scripts = await Promise.all(files.filter((f) => SCRIPT.test(f)).map((f) => dataLayerReadFile(f).catch(() => '')))
  return candidates.filter((f) => !scripts.some((text) => text.includes(f)))
}

// Earlier builds of a model the scene still places: kept for undo, safe to delete once the build is right.
export async function olderBuilds(): Promise<string[]> {
  const files = await dataLayerListFiles(IGNORED_DIRS)
  const placed = placedModels()
  const building = new Set([...placed].flatMap((path) => BUILT.exec(path)?.[1] ?? []))
  return files.filter((f) => !placed.has(f) && building.has(BUILT.exec(f)?.[1] ?? ''))
}

// what the dock's unused-files check depends on: any file change, or a different set of placed models
export function unusedModelsKey(): string {
  return `${dataLayerWriteTick()}|${[...placedModels()].sort().join(',')}`
}

// A built model's script goes with its last build.
export async function filesDeletedWith(path: string): Promise<string[]> {
  const built = BUILT.exec(path)
  if (built === null) return []
  const files = await dataLayerListFiles(IGNORED_DIRS)
  const others = files.filter((f) => f !== path && BUILT.exec(f)?.[1] === built[1])
  const script = `models/src/${built[1]}.js`
  return others.length === 0 && files.includes(script) ? [script] : []
}

export async function deleteProjectFile(path: string): Promise<void> {
  const failed = await dataLayerRemoveFiles([path, ...(await filesDeletedWith(path))])
  if (failed.includes(path)) throw new Error(`${path} could not be deleted`)
}
