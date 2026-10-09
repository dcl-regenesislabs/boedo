import { afterEach, describe, expect, it, vi } from 'vitest'
import { state, type Snapshot } from '@scene/state'
import { createUiTheme } from '../../../desktop/runtime-modules/pure/uiTheme'
import { startThemePreview } from './theme-preview'

const host = vi.hoisted(() => ({ setComponent: vi.fn(async (_id: string, _name: string, _json: string) => '') }))
vi.mock('./cmd', () => ({ cmd: { setComponent: host.setComponent } }))

function snapshot(accent = '#000000', appearance = 'Light'): Snapshot {
  return {
    '512': { 'asset-packs::Script': { value: [{ path: 'custom/ui_theme/scripts/ui-theme.ts', layout: JSON.stringify({ params: {
      accentColor: { type: 'string', value: accent }, appearance: { type: 'enum', value: appearance }
    }, actions: [] }) }] } },
    '600': { UiText: { value: 'TIME 0:37.3', color: createUiTheme().text },
      UiTransform: { display: 1, parent: 0, borderTopColor: createUiTheme().border },
      'editor::UiThemeBinding': { value: JSON.stringify({ text: { token: 'text', fallbackAccent: '#FF2D55' },
          background: { token: 'panel', fallbackAccent: '#FF2D55' }, border: { token: 'border', fallbackAccent: '#FF2D55' } }) },
      UiBackground: { color: createUiTheme().panel } },
    '601': { UiText: { value: 'Restart', color: createUiTheme('#0000FF').onAccent },
      'editor::UiThemeBinding': { value: JSON.stringify({ text: { token: 'onAccent', fallbackAccent: '#FF2D55' } }) } },
    '602': { UiText: { value: 'Custom UI', color: createUiTheme().text } }
  }
}

let stop: (() => void) | undefined
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
afterEach(() => { stop?.(); stop = undefined; host.setComponent.mockClear() })

describe('paused UI theme preview', () => {
  it('retints bound widgets while frozen as the theme is edited or deleted, leaving text, layout and custom UI alone', async () => {
    state.status = 'ready'
    state.frozen = true
    state.snapshot = snapshot()
    stop = startThemePreview()
    await settle()
    expect(state.snapshot['600'].UiText).toEqual({ value: 'TIME 0:37.3', color: createUiTheme('#000000', 'Light').text })
    expect(state.snapshot['600'].UiTransform).toMatchObject({ display: 1, parent: 0, borderTopColor: createUiTheme('#000000', 'Light').border })
    expect(state.snapshot['600'].UiBackground).toEqual({ color: createUiTheme('#000000', 'Light').panel })
    expect(host.setComponent.mock.calls.some(call => call[0] === '601' || call[0] === '602')).toBe(false)
    state.snapshot = { ...state.snapshot, '512': snapshot('#FF2D55', 'Dark')['512'] }
    await settle()
    expect(state.snapshot['600'].UiBackground).toEqual({ color: createUiTheme().panel })
    state.snapshot = { ...state.snapshot, '512': snapshot()['512'] }
    await settle()
    const { '512': _theme, ...withoutTheme } = state.snapshot
    state.snapshot = withoutTheme
    await settle()
    expect(state.snapshot['600'].UiBackground).toEqual({ color: createUiTheme().panel })
    expect(state.snapshot['600'].UiText).toMatchObject({ value: 'TIME 0:37.3' })
    expect(state.frozen).toBe(true)
  })

  it('cancels queued writes when play starts or the editor closes', async () => {
    let release!: (value: string) => void
    host.setComponent.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    state.status = 'ready'
    state.frozen = true
    state.snapshot = snapshot()
    stop = startThemePreview()
    state.frozen = false
    release('ok')
    await settle()
    expect(host.setComponent).toHaveBeenCalledTimes(1)
    state.snapshot = snapshot('#00FF00')
    await settle()
    expect(host.setComponent).toHaveBeenCalledTimes(1)
    stop()
    state.frozen = true
    state.snapshot = snapshot()
    await settle()
    expect(host.setComponent).toHaveBeenCalledTimes(1)
  })
})
