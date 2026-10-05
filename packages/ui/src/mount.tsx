// Mounts an editor view into a shadow root under `parent`, with the registered
// stylesheet. Shared by the host-app entry (main-embed.tsx) and the web target.
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './ds/styles'
import { focusables } from './ds/focus'
import { collectCss } from './ds/styles/registry'
import { EDITOR_UI_HOST_ID, fromEditorUi } from './engine/hosted'
import { TooltipLayer } from './panels/TooltipLayer'

export function mountEditorUi(parent: HTMLElement, view: ReactNode, rootClass?: string): () => void {
  const host = document.createElement('div')
  host.id = EDITOR_UI_HOST_ID
  parent.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = collectCss()
  shadow.appendChild(style)

  const rootEl = document.createElement('div')
  rootEl.className = rootClass === undefined ? 'eui-root' : `eui-root ${rootClass}`
  shadow.appendChild(rootEl)

  const root = createRoot(rootEl)
  // TooltipLayer is app-wide: one delegated listener styles every [data-tip] hover.
  root.render(
    <>
      {view}
      <TooltipLayer />
    </>
  )
  // The engine's canvas takes Tab as a game key and keeps focus for good: Tab
  // there goes back into this view (first control, or last with Shift).
  const onTab = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || e.defaultPrevented || !(e.composedPath()[0] instanceof HTMLCanvasElement) || fromEditorUi(e)) return
    if (host.getClientRects().length === 0) return
    const items = focusables(shadow)
    const to = e.shiftKey ? items[items.length - 1] : items[0]
    if (to === undefined) return
    e.preventDefault()
    e.stopPropagation()
    to.focus()
  }
  window.addEventListener('keydown', onTab, true)
  return () => {
    window.removeEventListener('keydown', onTab, true)
    root.unmount()
    host.remove()
  }
}
