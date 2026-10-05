// The composite step of a scene build, as sdk-commands' logic/composite.ts does it.
import { Composite, type CompositeDefinition, type CompositeProvider, Engine, EntityMappingMode } from '@pinned-sdk/ecs'
import { EditorComponentNames, dumpEngineToCrdtCommands } from '@pinned-sdk/inspector'
import type { BuildDiagnostic, ProjectFiles } from './build-events'

const COMPOSITE_FILE_MAX_BYTES = 16 * 1024 * 1024
const MAIN_COMPOSITE = 'assets/scene/main.composite'

export interface ScriptInstance extends Record<string, unknown> {
  path: string
  entity: number
}

export interface CompositeData {
  // source lines of the `~sdk/all-composites` module
  compositeLines: string[]
  scripts: Map<string, ScriptInstance[]>
  maxCompositeEntity: number
  // undefined when the project has no composite at all
  crdt: Uint8Array | undefined
  diagnostics: BuildDiagnostic[]
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function readComposites(files: ProjectFiles): CompositeData {
  const diagnostics: BuildDiagnostic[] = []
  const decoder = new TextDecoder()
  const composites: Record<string, CompositeDefinition> = {}
  const sources = [...files.keys()].filter((path) => path.endsWith('.composite')).sort()
  for (const file of sources) {
    try {
      const bytes = files.get(file) ?? new Uint8Array()
      if (bytes.length > COMPOSITE_FILE_MAX_BYTES) {
        throw new Error(`${bytes.length} bytes is over the ${COMPOSITE_FILE_MAX_BYTES} byte limit`)
      }
      composites[file] = Composite.fromJson(JSON.parse(decoder.decode(bytes)))
    } catch (err) {
      diagnostics.push({ severity: 'warning', file, message: `Composite '${file}' can't be read: ${describe(err)}` })
    }
  }

  const provider: CompositeProvider = {
    getCompositeOrNull: (src) => (src in composites ? { src, composite: composites[src] } : null)
  }
  const compositeLines: string[] = []
  const scripts = new Map<string, ScriptInstance[]>()
  const engine = Engine()
  for (const src of Object.keys(composites)) {
    try {
      const resource = { src, composite: composites[src] }
      Composite.instance(engine, resource, provider, {
        entityMapping: { type: EntityMappingMode.EMM_DIRECT_MAPPING, getCompositeEntity: (entity) => entity }
      })
      const scriptComponent = engine.getComponentOrNull(EditorComponentNames.Script)
      if (scriptComponent !== null) {
        for (const [entity, { value }] of engine.getEntitiesWith(scriptComponent)) {
          for (const script of value) {
            const path = String(script.path)
            const instances = scripts.get(path) ?? []
            instances.push({ ...script, path, entity })
            scripts.set(path, instances)
          }
        }
      }
      // only a root-level main.composite is inlined; the others load at runtime
      if (src === 'main.composite') {
        compositeLines.push(`'${src}':${JSON.stringify(Composite.toJson(resource.composite))}`)
      }
    } catch (err) {
      diagnostics.push({ severity: 'warning', file: src, message: `Composite '${src}' can't be instanced: ${describe(err)}` })
    }
  }

  let maxCompositeEntity = 0
  for (const composite of Object.values(composites)) {
    for (const component of composite.components) {
      for (const entity of component.data.keys()) {
        maxCompositeEntity = Math.max(maxCompositeEntity, (entity & 0xffff) >>> 0)
      }
    }
  }

  return {
    compositeLines,
    scripts,
    maxCompositeEntity,
    crdt: sources.length > 0 ? dumpEngineToCrdtCommands(engine) : undefined,
    diagnostics
  }
}

// Uses smart items: an asset-packs component other than the build-time Script.
export function isEditorScene(files: ProjectFiles): boolean {
  const bytes = files.get(MAIN_COMPOSITE)
  if (bytes === undefined) return false
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const components: unknown = typeof json === 'object' && json !== null && 'components' in json ? json.components : null
    return (
      Array.isArray(components) &&
      components.some(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          'name' in c &&
          typeof c.name === 'string' &&
          c.name.startsWith('asset-packs::') &&
          c.name !== 'asset-packs::Script'
      )
    )
  } catch {
    return false
  }
}
