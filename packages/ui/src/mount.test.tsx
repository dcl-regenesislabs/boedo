import { act } from 'react'
import { afterEach, expect, it } from 'vitest'
import { persistReady } from './core/persist'
import { mountEditorUi } from './mount'

let cleanup = (): void => {}
afterEach(() => cleanup())

it('keeps a wheel over the editor UI from the page window, where the explorer forwards it to the engine', async () => {
  let unmount = (): void => {}
  await act(async () => {
    unmount = mountEditorUi(document.body, null)
    await persistReady
  })
  const host = document.getElementById('editor-ui-host')
  const panel = document.createElement('div')
  host?.shadowRoot?.appendChild(panel)
  const bubbled: EventTarget[] = []
  const captured: EventTarget[] = []
  const onBubble = (e: Event): void => void bubbled.push(e.composedPath()[0])
  const onCapture = (e: Event): void => void captured.push(e.composedPath()[0])
  window.addEventListener('wheel', onBubble)
  window.addEventListener('wheel', onCapture, true)
  cleanup = () => {
    window.removeEventListener('wheel', onBubble)
    window.removeEventListener('wheel', onCapture, true)
    act(() => unmount())
  }

  panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, composed: true }))
  host?.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, composed: true }))

  expect(captured).toEqual([panel, host])
  expect(bubbled).toEqual([host])
})
