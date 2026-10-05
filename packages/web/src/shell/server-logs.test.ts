import { afterEach, describe, expect, it, vi } from 'vitest'
import { relayServerLogs } from './server-logs'

afterEach(() => {
  vi.useRealTimers()
})

describe('relaying the in-tab server copy’s console', () => {
  it('passes each line on once, across overlapping tails, a reloaded copy and an engine that refuses', async () => {
    vi.useFakeTimers()
    const replies: Array<string | Error> = [
      '[0.10] Log: [server] booted\n[0.20] Log: [server] round 1',
      '(+3 older entries not retained)\n[0.20] Log: [server] round 1\n[0.30] Log: [server] round 1',
      new Error('no server copy'),
      '[0.20] Log: [server] round 1\n[0.30] Log: [server] round 1',
      '[0.05] Log: [server] booted'
    ]
    const asked: string[] = []
    const emitted: string[] = []
    const stop = relayServerLogs(async (line) => {
      asked.push(line)
      const reply = replies.shift() ?? '(no logs)'
      if (reply instanceof Error) throw reply
      return reply
    }, (line) => emitted.push(line))
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(2000)
    stop()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(asked).toHaveLength(7)
    expect(new Set(asked)).toEqual(new Set(['scene_logs 200 --server']))
    expect(emitted).toEqual([
      '[0.10] Log: [server] booted',
      '[0.20] Log: [server] round 1',
      '[0.30] Log: [server] round 1',
      '[0.05] Log: [server] booted'
    ])
  })
})
