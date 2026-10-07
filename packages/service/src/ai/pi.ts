import {
  createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager
} from '@earendil-works/pi-coding-agent'
import type { FileEntry, ResourceLoader, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@earendil-works/pi-ai'
import { ASSET_KINDS, object } from '../../../contract/src/assistant.ts'
import type { AiProvider, AiSendParams } from '../../../contract/src/shell.ts'
import type { BrowserToolName } from '../../../contract/src/assistant.ts'
import type { AgentFactory } from './types.ts'
import { WEB_ASSISTANT_PROMPT } from './prompt.ts'
import { seedSetupToken } from './setup-token.ts'
import { createSkillsComponent } from '../adapters/skills.ts'
import type { SkillsComponent } from '../adapters/skills.ts'

const PROVIDERS = { claude: 'anthropic', codex: 'openai-codex' } as const

function resources(skills: SkillsComponent): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => `${WEB_ASSISTANT_PROMPT}\n\nAvailable SDK skill documents:\n${skills.catalog}`,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {}
  }
}

// one model for every turn: the strongest, and no choice to make in the composer
export const ASSISTANT_MODEL = 'claude-opus-5-5'

export async function createPiFactory(authPath: string, preferredModel?: string, setupToken?: string, skills?: SkillsComponent): Promise<AgentFactory> {
  const skillLibrary = skills ?? await createSkillsComponent()
  if (setupToken !== undefined) await seedSetupToken(authPath, setupToken)
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false })
  if (preferredModel !== undefined && !Object.values(PROVIDERS).some((provider) =>
    runtime.getModels(provider).some((model) => model.id === preferredModel))) throw new Error('AI_MODEL is not a supported model')
  for (const id of Object.values(PROVIDERS)) {
    const provider = runtime.getProvider(id)
    const oauth = provider?.auth.oauth
    if (provider !== undefined && oauth !== undefined) {
      runtime.registerNativeProvider({ ...provider, auth: { oauth: {
        ...oauth,
        refresh: (credential, signal) => {
          if (credential.setupToken === true) return Promise.reject(new Error('Rotate the expired Claude setup token and restart the service.'))
          return oauth.refresh(credential, signal)
        }
      } } })
    }
  }
  const providers: AgentFactory['providers'] = async () => {
    const credentials = await runtime.listCredentials()
    return (Object.entries(PROVIDERS) as Array<[AiProvider, string]>).map(([id, provider]) => {
      const all = runtime.getModels(provider).map((model) => model.id)
      // a configured model is the only one offered, so clients cannot pick a costlier one
      const models = preferredModel === undefined ? all : all.filter((model) => model === preferredModel)
      const available = credentials.some((c) => c.providerId === provider && c.type === 'oauth') && models.length > 0
      return {
        id, label: id === 'claude' ? 'Claude' : 'Codex', available, models,
        defaultModel: models.find((model) => model === preferredModel) ?? [...models].reverse().find((m) => m.includes('opus')) ?? models[models.length - 1] ?? '',
        transport: 'service' as const,
        ...(!available ? { reason: 'This provider is not signed in on the assistant service.' } : {})
      }
    })
  }
  return {
    providers,
    async create(params, call, emit, restore) {
      const info = (await providers()).find((p) => p.id === params.provider)
      if (info === undefined || !info.available) throw new Error('Provider unavailable')
      const chosen = params.model ?? info.defaultModel
      if (!info.models.includes(chosen)) throw new Error('Unknown model')
      const model = runtime.getModel(PROVIDERS[info.id], chosen)
      if (model === undefined) throw new Error('Unknown model')
      const schema = {
        list_files: Type.Object({
          kind: Type.Optional(Type.Union([...ASSET_KINDS].map((kind) => Type.Literal(kind)))),
          match: Type.Optional(Type.String())
        }),
        read_file: Type.Object({ path: Type.String() }),
        write_file: Type.Object({ path: Type.String(), content: Type.String(), revision: Type.Union([Type.String(), Type.Null()]) }),
        scene_request: Type.Object({ request: Type.Object({ type: Type.String() }, { additionalProperties: true }) }),
        build: Type.Object({})
      }
      const descriptions: Record<BrowserToolName, string> = {
        list_files: 'List the open browser project\'s files, optionally only one kind (models, images, sounds, videos, data, code) and those whose path contains match. read_file opens code and data; models, images, sounds and videos are referenced by path.',
        read_file: 'Read a browser project file and its revision. Missing files have a null revision.',
        write_file: 'Create or replace source code, only if its revision still matches.',
        scene_request: 'Inspect or change the live scene using the editor actions documented in the system prompt.',
        build: 'Compile the current browser project and return diagnostics. Does not publish or run it.'
      }
      const tools: ToolDefinition[] = (Object.keys(schema) as BrowserToolName[]).map((name) => ({
        name, label: name, description: descriptions[name], parameters: schema[name],
        execute: async (_id, args, signal) => {
          if (!object(args)) throw new Error('Invalid tool arguments')
          return { content: [{ type: 'text' as const, text: await call(name, args, signal) }], details: {} }
        }
      }))
      tools.push({
        name: 'read_skill', label: 'Read SDK skill',
        description: 'Read bundled Decentraland SDK guidance or references. Paths are relative to the skill library, not the project. Follow nextOffset for more; query searches a document and returns matching lines with offsets.',
        parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })), query: Type.Optional(Type.String()) }),
        execute: async (_id, args) => {
          if (!object(args) || typeof args.path !== 'string' ||
            (args.offset !== undefined && typeof args.offset !== 'number') ||
            (args.query !== undefined && typeof args.query !== 'string')) throw new Error('Invalid skill arguments')
          return { content: [{ type: 'text', text: skillLibrary.read(args.path, args.offset, args.query) }], details: {} }
        }
      })
      const sessionManager = SessionManager.inMemory(undefined, undefined, restore as FileEntry[] | undefined)
      const { session } = await createAgentSession({
        modelRuntime: runtime, model, resourceLoader: resources(skillLibrary),
        sessionManager, settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
        tools: tools.map((tool) => tool.name), customTools: tools
      })
      if (session.getActiveToolNames().some((name) => !tools.some((tool) => tool.name === name))) {
        session.dispose()
        throw new Error('Unexpected assistant tool')
      }
      // usage already counted: a restored conversation was paid for when it ran
      let counted = session.getSessionStats().cost
      let emittedText = false
      let separator = false
      session.subscribe((event) => {
        if (event.type === 'message_start' && event.message.role === 'assistant') separator = emittedText
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          const delta = event.assistantMessageEvent.delta
          if (delta === '') return
          emit({ text: `${separator ? '\n\n' : ''}${delta}` })
          emittedText = true
          separator = false
        }
      })
      return {
        async prompt(next: AiSendParams) {
          emittedText = false
          separator = false
          const images = next.images?.map((image) => {
            const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl)
            if (match === null) throw new Error('Invalid image')
            return { type: 'image' as const, mimeType: match[1], data: match[2] }
          })
          await session.prompt(`${next.context ?? ''}\n\n${next.text}`, { images })
          const last = session.messages.at(-1)
          if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
            throw new Error('The model did not complete this turn.')
          }
        },
        takeUsage() {
          const stats = session.getSessionStats()
          const cost = Math.max(0, stats.cost - counted)
          counted = stats.cost
          return { cost }
        },
        abort: () => session.abort(),
        dispose: () => session.dispose(),
        snapshot: () => {
          const header = sessionManager.getHeader()
          return header === null ? sessionManager.getEntries() : [header, ...sessionManager.getEntries()]
        }
      }
    }
  }
}
