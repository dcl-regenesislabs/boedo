// The pinned SDK's composite tooling; scripts/build.mjs aliases these names
// to the installed files. Only what the composite step uses is declared.

declare module '@pinned-sdk/ecs' {
  export interface CompositeDefinition {
    components: { name: string; data: Map<number, unknown> }[]
  }
  export interface CompositeResource {
    src: string
    composite: CompositeDefinition
  }
  export interface CompositeProvider {
    getCompositeOrNull(src: string): CompositeResource | null
  }
  export interface ComponentDefinition {
    componentName: string
  }
  export interface IEngine {
    getComponentOrNull(name: string): ComponentDefinition | null
    getEntitiesWith(component: ComponentDefinition): Iterable<[number, { value: Record<string, unknown>[] }]>
  }
  export function Engine(): IEngine
  export const EntityMappingMode: { EMM_DIRECT_MAPPING: number }
  export const Composite: {
    fromJson(json: unknown): CompositeDefinition
    toJson(composite: CompositeDefinition): unknown
    instance(
      engine: IEngine,
      resource: CompositeResource,
      provider: CompositeProvider,
      options: { entityMapping: { type: number; getCompositeEntity(entity: number): number } }
    ): void
  }
}

declare module '@pinned-sdk/inspector' {
  import type { IEngine } from '@pinned-sdk/ecs'
  export const EditorComponentNames: { Script: string }
  export function dumpEngineToCrdtCommands(engine: IEngine): Uint8Array
}
