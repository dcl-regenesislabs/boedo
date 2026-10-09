import { afterEach, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import type { LiveSceneInfo } from '@scene/bevy-api/interface'
import { waitForPreviewLayout } from './preview-layout'

const scene = (parcels: string[]): LiveSceneInfo => ({ hash: 'preview', title: 'Tower', parcels: parcels.map(p => {
  const [x, y] = p.split(',').map(Number); return { x, y }
}), isPortable: false, isBroken: false, isBlocked: false, isSuper: false, sdkVersion: '7' })
afterEach(() => vi.useRealTimers())

it('holds the tool until a new preview is ready and frozen on all requested parcels', async () => {
  state.scene = scene(['0,0']); state.status = 'ready'; state.frozen = true
  const done = vi.fn()
  const waiting = waitForPreviewLayout(['0,0', '1,0'], () => {}, new AbortController().signal).then(done)
  state.scene = scene(['0,0'])
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  state.status = 'loading-snapshot'; state.scene = scene(['1,0', '0,0'])
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  state.status = 'ready'
  await waiting
  expect(done).toHaveBeenCalledOnce()
})

it('rejects cancellation and a preview that never applies the new layout', async () => {
  vi.useFakeTimers()
  const signal = new AbortController()
  const aborted = waitForPreviewLayout(['0,0'], () => {}, signal.signal)
  signal.abort(new Error('Scene changed'))
  await expect(aborted).rejects.toThrow('Scene changed')
  const timed = expect(waitForPreviewLayout(['9,9'], () => {}, new AbortController().signal)).rejects.toThrow('new parcels')
  await vi.advanceTimersByTimeAsync(90_000)
  await timed
})
