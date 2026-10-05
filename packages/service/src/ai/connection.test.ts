import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ResourceLoader } from '@earendil-works/pi-coding-agent'
import { fauxAssistantMessage, fauxProvider, fauxToolCall, Type } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantServerMessage } from '../../../contract/src/assistant.ts'
import type { AiSendParams } from '../../../contract/src/shell.ts'
import { createConnection, parsePrompt } from './connection.ts'
import type { AgentFactory } from './types.ts'

const params = { provider: 'claude' as const, model: 'test', text: 'Edit the door' }

describe('assistant tool bridge', () => {
  it('waits for the matching browser result and retains the agent for the next turn', async () => {
    const events: AssistantServerMessage[] = []
    const results: string[] = []
    const factory: AgentFactory = {
      providers: async () => [],
      create: vi.fn(async (_params, call, emit) => ({
        prompt: async () => { results.push(await call('read_file', { path: 'src/scripts/Door.ts' })); emit({ text: 'Done' }) },
        abort: async () => {}, dispose: () => {}
      }))
    }
    const connection = createConnection({ factory, send: (e) => events.push(e), allowTurn: () => true })
    connection.receive({ kind: 'prompt', turnId: 'one', projectId: 'scene', params })
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'call')).toBe(true))
    const call = events.find((e) => e.kind === 'call')
    if (call?.kind !== 'call') throw new Error('No call')
    connection.receive({ kind: 'result', turnId: 'foreign', callId: call.callId, ok: true, text: 'wrong' })
    expect(results).toEqual([])
    connection.receive({ kind: 'result', turnId: 'one', callId: call.callId, ok: true, text: 'browser content' })
    await vi.waitFor(() => expect(events).toContainEqual({ kind: 'event', event: { kind: 'done', turnId: 'one', ok: true } }))
    expect(results).toEqual(['browser content'])
    connection.receive({ kind: 'prompt', turnId: 'two', projectId: 'scene', params })
    expect(factory.create).toHaveBeenCalledTimes(1)
    connection.close()
  })

  it('cancels a pending browser tool and disposes the agent on disconnect', async () => {
    const dispose = vi.fn()
    const abort = vi.fn(async () => {})
    const events: AssistantServerMessage[] = []
    const factory: AgentFactory = {
      providers: async () => [],
      create: async (_params, call) => ({
        prompt: async () => { await call('write_file', { path: 'src/scripts/Door.ts' }) }, abort, dispose
      })
    }
    const connection = createConnection({ factory, send: (e) => events.push(e), allowTurn: () => true })
    connection.receive({ kind: 'prompt', turnId: 'one', projectId: 'scene', params })
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'call')).toBe(true))
    connection.close()
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(abort).toHaveBeenCalledOnce()
    expect(events.filter((e) => e.kind === 'event' && e.event.kind === 'done')).toEqual([])
  })

  it('stops the turn after a browser timeout, prevents retries, and hides provider errors', async () => {
    const events: AssistantServerMessage[] = []
    let toolError = ''
    const connection = createConnection({
      send: (e) => events.push(e), allowTurn: () => true, toolTimeoutMs: 5,
      factory: {
        providers: async () => [],
        create: async (_params, call) => ({
          async prompt() {
            try { await call('build', {}) } catch (error) { toolError = String(error) }
            await expect(call('build', {})).rejects.toThrow('cancelled')
            throw new Error('a provider credential must not appear')
          },
          abort: async () => {}, dispose: () => {}
        })
      }
    })
    connection.receive({ kind: 'prompt', turnId: 'one', projectId: 'scene', params })
    await vi.waitFor(() => expect(events).toContainEqual({ kind: 'event', event: { kind: 'done', turnId: 'one', ok: false } }))
    expect(toolError).toContain('browser did not answer')
    expect(events.filter((event) => event.kind === 'call')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('credential must not appear')
    connection.close()
  })

  it('keeps the session after a turn limit so the next prompt continues it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dcl-agent-resume-'))
    const runtime = await ModelRuntime.create({ authPath: join(directory, '.auth.json'), modelsPath: null, refreshOnCreate: false })
    const faux = fauxProvider({ provider: 'anthropic', models: [{ id: 'test' }] })
    runtime.registerNativeProvider(faux.provider)
    const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }
    const resources: ResourceLoader = {
      getExtensions: () => extensions, getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => '', getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {}
    }
    const sessions: Array<Awaited<ReturnType<typeof createAgentSession>>['session']> = []
    const factory: AgentFactory = {
      providers: async () => [],
      create: vi.fn(async (_params, call) => {
        const model = runtime.getModel('anthropic', 'test')
        if (model === undefined) throw new Error('No faux model')
        const { session } = await createAgentSession({
          modelRuntime: runtime, model, resourceLoader: resources, sessionManager: SessionManager.inMemory(),
          settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }), tools: ['build'],
          customTools: [{
            name: 'build', label: 'build', description: 'Build', parameters: Type.Object({}),
            execute: async (_id, _args, signal) => ({ content: [{ type: 'text', text: await call('build', {}, signal) }], details: {} })
          }]
        })
        sessions.push(session)
        return { prompt: async (next: AiSendParams) => { await session.prompt(next.text) }, abort: () => session.abort(), dispose: () => session.dispose() }
      })
    }
    const events: AssistantServerMessage[] = []
    const connection = createConnection({ factory, send: (e) => events.push(e), allowTurn: () => true, turnTimeoutMs: 50 })
    faux.setResponses([fauxAssistantMessage(fauxToolCall('build', {}), { stopReason: 'toolUse' })])
    connection.receive({ kind: 'prompt', turnId: 'one', projectId: 'scene', params: { ...params, text: 'Build a door' } })
    await vi.waitFor(() => expect(events).toContainEqual({ kind: 'event', event: { kind: 'done', turnId: 'one', ok: false } }))
    expect(events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ kind: 'error', resumable: true }) }))

    faux.setResponses([fauxAssistantMessage('Continued the door')])
    connection.receive({ kind: 'prompt', turnId: 'two', projectId: 'scene', params: { ...params, text: 'Continue' } })
    await vi.waitFor(() => expect(events).toContainEqual({ kind: 'event', event: { kind: 'done', turnId: 'two', ok: true } }))
    expect(factory.create).toHaveBeenCalledOnce()
    const asked = sessions[0].messages.filter((m) => m.role === 'user').map((m) => JSON.stringify(m.content))
    expect(asked).toEqual([expect.stringContaining('Build a door'), expect.stringContaining('Continue')])
    await connection.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('validates messages before spending a model call', () => {
    expect(parsePrompt(params)).toEqual(params)
    expect(parsePrompt({ ...params, text: ' ' })).toBeNull()
    expect(parsePrompt({ ...params, provider: 'arbitrary-provider' })).toBeNull()
    expect(parsePrompt({ ...params, images: [{ name: 'large', dataUrl: 'a'.repeat(2_800_001) }] })).toBeNull()
  })
})
