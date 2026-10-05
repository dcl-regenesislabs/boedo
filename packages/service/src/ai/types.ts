import type { AiEvent, AiProviderInfo, AiSendParams } from '../../../contract/src/shell.ts'
import type { BrowserToolName } from '../../../contract/src/assistant.ts'

export interface AssistantAgent {
  prompt(params: AiSendParams): Promise<void>
  abort(): Promise<void>
  dispose(): void
}

export interface AgentFactory {
  providers(): Promise<AiProviderInfo[]>
  create(
    params: AiSendParams,
    call: (tool: BrowserToolName, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>,
    emit: (event: Pick<Extract<AiEvent, { kind: 'text' }>, 'text'>) => void
  ): Promise<AssistantAgent>
}

export interface AssistantService {
  handle(request: Request, path: string, wallet: string): Promise<Response>
}
