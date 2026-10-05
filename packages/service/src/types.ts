import type { IHttpServerComponent } from '@dcl/core-commons'
import type { IBaseComponent, IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import type { AssistantComponent } from './ai/server.ts'
import type { metricDeclarations } from './metrics.ts'
import type { PurgeResult } from './purge.ts'
import type { BlobStore } from './store.ts'
import type { SkillsComponent } from './adapters/skills.ts'

export interface ProjectStorageComponent {
  handle(request: Request): Promise<Response>
  purge(): Promise<PurgeResult>
}

export interface GlobalContext {
  components: BaseComponents
}

export interface BaseComponents {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  server: IHttpServerComponent<GlobalContext> & IBaseComponent
  store: BlobStore
  skills: SkillsComponent
  projectStorage: ProjectStorageComponent
  assistant: AssistantComponent
}

export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
  purgeJob: IBaseComponent
}
