import type { AiEvent, AiProviderInfo, AiSendParams } from '../../../contract/src/shell.ts'
import type { BrowserToolName } from '../../../contract/src/assistant.ts'
import type { WalletImages } from './thumbnail.ts'

export interface AssistantAgent {
  prompt(params: AiSendParams): Promise<void>
  abort(): Promise<void>
  dispose(): void
  /** Cost of model calls since the last take, including compaction. */
  takeUsage(): TurnUsage
  /** What the model remembers so far, for `create` to start from again. */
  snapshot(): unknown[]
}

export interface TurnUsage {
  /** Priced at the model's API rates, for the service's internal allowance. */
  cost: number
}

export type BrowserCall = (tool: BrowserToolName, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>

export interface AgentFactory {
  providers(): Promise<AiProviderInfo[]>
  create(
    params: AiSendParams,
    call: BrowserCall,
    emit: (event: Pick<Extract<AiEvent, { kind: 'text' }>, 'text'>) => void,
    restore?: unknown[],
    images?: WalletImages
  ): Promise<AssistantAgent>
}

export interface AssistantService {
  handle(request: Request, path: string, wallet: string): Promise<Response>
}
