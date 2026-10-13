import { afterEach, expect, it, vi } from 'vitest'
import { movementKeys, playerPosition, steerJump } from './movement-keys'

const origin = { x: 0, y: 0, z: 0 }
const camera = { x: 0, y: 0, z: 0, w: 1 }
afterEach(() => vi.useRealTimers())

it('steers in world space for forward, reversed and east-facing cameras', () => {
  const east = { x: 3, y: 0, z: 0 }
  expect(movementKeys(origin, east, camera)).toEqual(['D'])
  expect(movementKeys(origin, east, { x: 0, y: 1, z: 0, w: 0 })).toEqual(['A'])
  expect(movementKeys(origin, east, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 })).toEqual(['W'])
  expect(movementKeys(origin, { x: 3, y: 4, z: 3 }, camera)).toEqual(['W', 'D'])
  expect(movementKeys(origin, { x: 0.1, y: 0, z: 0.1 }, camera)).toEqual([])
})

it('parses actual console positions and rejects missing/nonfinite data', () => {
  expect(playerPosition('Player position: (1.2, -3e-1, 4)')).toEqual({ x: 1.2, y: -0.3, z: 4 })
  expect(playerPosition('(1e999, 0, 0)')).toBeNull()
  expect(playerPosition('unavailable')).toBeNull()
})

it('jumps after a slow initial position reply and waits for landing height', async () => {
  vi.useFakeTimers()
  let calls = 0
  const keys = vi.fn()
  const target = { x: 3, y: 1, z: 0 }
  const result = steerJump(target, camera, {
    keys,
    position: async () => {
      if (++calls === 1) { await new Promise((resolve) => setTimeout(resolve, 300)); return origin }
      return { ...target, y: calls < 17 ? 2.5 : 1 }
    }
  }, new AbortController().signal)
  await vi.runAllTimersAsync()
  await result
  expect(keys.mock.calls[0][0]).toEqual(['D', 'Space'])
  expect(calls).toBeGreaterThanOrEqual(17)
  expect(keys.mock.calls.at(-1)?.[0]).toEqual([])
})

it('fails an unreachable landing and releases keys', async () => {
  vi.useFakeTimers()
  const keys = vi.fn()
  const result = steerJump({ x: 10, y: 1, z: 0 }, camera, { keys, position: async () => origin }, new AbortController().signal)
  const rejected = expect(result).rejects.toThrow('landing')
  await vi.runAllTimersAsync()
  await rejected
  expect(keys.mock.calls.at(-1)?.[0]).toEqual([])
})

it('releases movement before momentum carries a landing past its target', async () => {
  vi.useFakeTimers()
  const positions = [2, 2.3, 2.5, 2.7, 2.8]
  let sample = 0
  const keys = vi.fn()
  const result = steerJump({ x: 3, y: 1, z: 0 }, camera, {
    keys,
    position: async () => ({ x: positions[Math.min(sample++, positions.length - 1)], y: 1, z: 0 })
  }, new AbortController().signal)
  await vi.runAllTimersAsync()
  await result
  expect(keys.mock.calls[2][0]).toEqual(['Space'])
  expect(keys.mock.calls.at(-1)?.[0]).toEqual([])
})
