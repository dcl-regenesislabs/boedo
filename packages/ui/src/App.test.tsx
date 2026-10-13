import { afterEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { mount, run, type Mounted } from './test/render'
import { aiStore } from './panels/ai-store'
import { state } from '@scene/state'

vi.mock('./boot/boot', async (real) => ({ ...(await real<object>()), getBootPhase: () => 'ready', isViewportReady: () => true }))

let ui: Mounted | null = null
afterEach(() => {
  run(() => (aiStore.turnRunning = false))
  ui?.unmount()
  ui = null
})

const shown = (el: HTMLElement | null): boolean => el !== null && el.closest('[hidden]') === null

it('hides the editor chrome while playing and brings the same panels back on stop', () => {
  ui = mount(<App />)
  const toolbar = ui.find('.eui-toolbar')
  const left = ui.find('.eui-left')
  expect(shown(toolbar) && shown(left) && shown(ui.find('.eui-right-col'))).toBe(true)

  ui.render(<App playing />)
  expect([toolbar, left, ui.find('.eui-right-col')].map(shown)).toEqual([false, false, false])

  ui.render(<App playing={false} />)
  expect(ui.find('.eui-toolbar')).toBe(toolbar)
  expect(ui.find('.eui-left')).toBe(left)
  expect(shown(toolbar) && shown(left) && shown(ui.find('.eui-right-col'))).toBe(true)
})

it('keeps the assistant on screen for the Play its own turn started', () => {
  ui = mount(<App />)
  run(() => (aiStore.turnRunning = true))
  ui.render(<App playing />)
  run(() => (aiStore.turnRunning = false))
  expect(shown(ui.find('.eui-right-col'))).toBe(true)
  expect(shown(ui.find('.eui-toolbar'))).toBe(false)

  ui.render(<App playing={false} />)
  ui.render(<App playing />)
  expect(shown(ui.find('.eui-right-col'))).toBe(false)
})

it('does not warn about editing over a full-screen game', () => {
  ui = mount(<App playing />)
  run(() => (state.playEditWarn = true))
  expect(ui.text()).not.toContain('Editing while playing')
  expect(state.playEditWarn).toBe(false)
})
