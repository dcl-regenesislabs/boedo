import { beforeEach, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { uiPause } from './playback'

const host = vi.hoisted(() => ({ reload: vi.fn(), hide: vi.fn() }))
vi.mock('@scene/inspector', () => ({
  pauseScene: async () => { state.frozen = true; return true },
  reloadSnapshot: () => host.reload(), playScene: vi.fn(), stepScene: vi.fn(), saveCompositeDirect: vi.fn()
}))
vi.mock('../engine/scene-ui', () => ({ autoHideSceneUi: () => host.hide(), releaseAutoHiddenSceneUi: vi.fn() }))
vi.mock('../engine/cmd', () => ({ cmd: {} }))
vi.mock('../engine/bus', () => ({ sendToScene: vi.fn() }))
vi.mock('../core/autosave', () => ({ flushPendingSave: vi.fn() }))
vi.mock('../features/editor/scene-health', () => ({ awaitFreshBundle: vi.fn(), noteSceneUpToDate: vi.fn(), sceneNeedsReload: vi.fn(), wireSceneHealth: vi.fn() }))
vi.mock('../features/editor/scene-checks', () => ({ consumePlayOverride: vi.fn(), playBlockingFindings: vi.fn(), revealSceneChecks: vi.fn() }))
vi.mock('../panels/authored-ids', () => ({ refreshAuthoredIds: vi.fn() }))
vi.mock('./selection', () => ({ uiSetCamera: vi.fn() }))

beforeEach(() => { host.reload.mockReset(); host.hide.mockReset(); state.snapshot = {} })

it('captures runtime HUD entities on Pause before applying edit-mode UI', async () => {
  state.frozen = false
  host.reload.mockImplementation(() => {
    expect(state.frozen).toBe(true)
    state.snapshot = { '600': { UiText: { value: 'Time 0:37' }, 'editor::UiThemeBinding': { value: '{}' } } }
  })
  host.hide.mockImplementation(() => expect(state.snapshot['600'].UiText).toEqual({ value: 'Time 0:37' }))
  await uiPause()
  expect(host.reload).toHaveBeenCalledTimes(1)
})

it('keeps optimistic edits when asked to pause an already frozen scene', async () => {
  state.frozen = true
  await uiPause()
  expect(host.reload).not.toHaveBeenCalled()
})
