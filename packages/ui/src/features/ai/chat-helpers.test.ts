import { describe, expect, it } from 'vitest'
import { keptTranscript, restoredTranscript } from './chat-helpers'
import type { ChatMsg } from './transcript'

describe('kept assistant chat', () => {
  it('brings built-model cards back after a reload, only for model files', () => {
    const trophy = { name: 'Golden Trophy', path: 'models/goldentrophy-675f6429.glb', triangles: 1824 }
    const chat: ChatMsg[] = [{ role: 'assistant', text: 'Built it.', tools: [], done: true, models: [trophy, { ...trophy, path: '../secret.glb' }] }]
    const stored: unknown = JSON.parse(JSON.stringify(keptTranscript(chat)))
    expect(restoredTranscript(stored)).toEqual([{ role: 'assistant', text: 'Built it.', tools: [], done: true, models: [trophy] }])
  })
})
