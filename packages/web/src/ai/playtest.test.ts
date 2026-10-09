// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playtest } from './playtest'

const mock = vi.hoisted(() => ({
  state: { frozen: false, saveStatus: '' },
  play: vi.fn(async () => {}), restart: vi.fn(async () => {}),
  command: vi.fn(async (_command: string, _args?: string[]) => '(1, 2, 3)')
}))
vi.mock('@scene/state', () => ({ state: mock.state }))
vi.mock('@scene/inspector', () => ({ syncFrozenState: async () => {} }))
vi.mock('@ui/actions/playback', () => ({ uiPlay: mock.play }))
vi.mock('@ui/boot/boot', () => ({ restartScene: mock.restart }))
vi.mock('@ui/engine/console', () => ({ consoleCommand: mock.command, getEngineWindow: () => window }))
vi.mock('@ui/engine/cmd', () => ({ cmd: {
  crdtSnapshot: async () => ({ '2': { Transform: { rotation: { x: 0, y: 0, z: 0, w: 1 } } }, '512': { UiText: { value: '3 / 5' } } }), sceneLogs: async () => ''
} }))
vi.mock('@ui/engine/hosted', () => ({ hostV1: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  mock.state.frozen = false
  mock.state.saveStatus = ''
  document.body.innerHTML = '<canvas tabindex="0"></canvas>'
})
afterEach(() => vi.useRealTimers())

describe('assistant playtesting', () => {
  it('releases held movement keys when a turn is cancelled', async () => {
    const controller = new AbortController()
    const released: string[] = []
    const canvas = document.querySelector('canvas')!
    canvas.addEventListener('keydown', () => controller.abort())
    canvas.addEventListener('keyup', (event) => released.push(event.code))
    await expect(playtest({ action: 'input', keys: ['W', 'Space'], durationMs: 5000 }, controller.signal)).rejects.toThrow()
    expect(released).toEqual(['KeyW', 'Space'])
    expect(mock.command).not.toHaveBeenCalled()
  })

  it('refuses a blocked Play and never sends player input in edit mode', async () => {
    mock.state.frozen = true
    mock.state.saveStatus = 'Missing checkpoint'
    await expect(playtest({ action: 'start' }, new AbortController().signal)).rejects.toThrow('Missing checkpoint')
    await expect(playtest({ action: 'input', keys: ['W'] }, new AbortController().signal)).rejects.toThrow('Start playtesting')
    expect(mock.command).not.toHaveBeenCalled()
  })

  it('reports observed player position and HUD without changing game state', async () => {
    expect(await playtest({ action: 'status' }, new AbortController().signal)).toEqual({
      playing: true, position: { x: 1, y: 2, z: 3 }, hud: ['3 / 5'], errors: [], serverErrors: []
    })
    expect(mock.command).toHaveBeenCalledTimes(1)
    expect(mock.command).toHaveBeenCalledWith('player_position')
  })

  it('bounds durations and rejects arbitrary keys and nonfinite targets', async () => {
    for (const request of [
      { action: 'input', keys: ['Meta'] }, { action: 'input', keys: ['W'], durationMs: Infinity },
      { action: 'wait', durationMs: 5001 }, { action: 'walk', to: { x: NaN, y: 0, z: 0 } },
      { action: 'click', x: -1, y: 0.5 }
    ]) await expect(playtest(request, new AbortController().signal)).rejects.toThrow()
    expect(mock.command).not.toHaveBeenCalled()
  })

  it('steers a jump with camera-relative keys and releases them on cancellation', async () => {
    const controller = new AbortController()
    const pressed: string[] = []
    const released: string[] = []
    const canvas = document.querySelector('canvas')!
    canvas.addEventListener('keydown', (event) => {
      pressed.push(event.code)
      if (event.code === 'Space') controller.abort()
    })
    canvas.addEventListener('keyup', (event) => released.push(event.code))
    await expect(playtest({ action: 'walk', to: { x: 5, y: 2, z: 3 }, jump: true }, controller.signal)).rejects.toThrow()
    expect(pressed).toEqual(['KeyD', 'Space'])
    expect(released).toEqual(['KeyD', 'Space'])
    expect(mock.command.mock.calls.every((call) => call[0] === 'player_position')).toBe(true)
  })

})
