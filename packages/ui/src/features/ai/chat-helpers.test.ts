import { describe, expect, it } from 'vitest'
import { keptTranscript, restoredTranscript } from './chat-helpers'
import type { ChatMsg } from './transcript'

describe('kept assistant chat', () => {
  it('brings built-model and thumbnail cards back after a reload, only for their own files', () => {
    const trophy = { name: 'Golden Trophy', path: 'models/goldentrophy-675f6429.glb', triangles: 1824 }
    const poster = { path: 'assets/images/thumbnail-2.jpg', version: 2 }
    const chat: ChatMsg[] = [{
      role: 'assistant', text: 'Built it.', tools: [], done: true,
      models: [trophy, { ...trophy, path: '../secret.glb' }],
      thumbnails: [poster, { path: '../secret.jpg', version: 3 }, { path: 'assets/images/thumbnail-4.jpg', version: 5 }]
    }]
    const stored: unknown = JSON.parse(JSON.stringify(keptTranscript(chat)))
    expect(restoredTranscript(stored)).toEqual([{ role: 'assistant', text: 'Built it.', tools: [], done: true, models: [trophy], thumbnails: [poster] }])
  })
})
