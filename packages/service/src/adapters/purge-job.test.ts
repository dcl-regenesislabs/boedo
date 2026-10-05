import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { afterEach, expect, it, vi } from 'vitest'
import { createPurgeJobComponent } from './purge-job.ts'

afterEach(() => vi.useRealTimers())

it('does not overlap purges and waits for pending work on shutdown', async () => {
  vi.useFakeTimers()
  const result = { projects: 0, references: 0, tickets: 0, wallets: 0, done: true }
  let finish: (value: typeof result) => void = () => { throw new Error('Purge not started') }
  const purge = vi.fn().mockResolvedValueOnce(result).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const error = vi.fn()
  const job = createPurgeJobComponent({
    projectStorage: { purge, handle: async () => new Response() },
    logs: { getLogger: () => ({ error, info: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn() }) }
  }, 100)
  await job[START_COMPONENT]?.({ started: () => true, live: () => true, getComponents: () => ({}) })
  await vi.advanceTimersByTimeAsync(300)
  expect(purge).toHaveBeenCalledTimes(2)
  let stopped = false
  const stop = job[STOP_COMPONENT]?.().then(() => { stopped = true })
  await vi.advanceTimersByTimeAsync(300)
  expect(stopped).toBe(false)
  expect(purge).toHaveBeenCalledTimes(2)
  finish(result)
  await stop
  await vi.advanceTimersByTimeAsync(300)
  expect(purge).toHaveBeenCalledTimes(2)
  expect(error).not.toHaveBeenCalled()
})
