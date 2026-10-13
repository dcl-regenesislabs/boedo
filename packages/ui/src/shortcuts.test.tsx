import { beforeEach, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { runShortcutFor } from './shortcuts'

const scene = vi.hoisted(() => ({ pause: vi.fn(), play: vi.fn() }))
vi.mock('@scene/inspector', async (real) => ({
  ...(await real<object>()),
  pauseScene: scene.pause,
  playScene: scene.play,
  reloadSnapshot: vi.fn()
}))
vi.mock('./engine/scene-ui', () => ({ autoHideSceneUi: vi.fn(), releaseAutoHiddenSceneUi: vi.fn() }))

beforeEach(() => {
  scene.pause.mockClear()
  scene.play.mockClear()
})

it('stops a running scene on F5', async () => {
  state.frozen = false
  expect(runShortcutFor(new KeyboardEvent('keydown', { key: 'F5' }))).toBe(true)
  await vi.waitFor(() => expect(scene.pause).toHaveBeenCalledTimes(1))
  expect(scene.play).not.toHaveBeenCalled()
})

it('ignores the repeats of a held F5', () => {
  state.frozen = false
  expect(runShortcutFor(new KeyboardEvent('keydown', { key: 'F5', repeat: true }))).toBe(false)
  expect(scene.pause).not.toHaveBeenCalled()
  expect(scene.play).not.toHaveBeenCalled()
})
