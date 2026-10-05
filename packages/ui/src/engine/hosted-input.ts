// Hosted mode: the engine's canvas lives in the same document as the editor, so
// what engine-host.ts and embed.ts did from inside the engine iframe is done here,
// on the host's window, for as long as a project is open.
import { isMod } from '../lib/keys'
import { isEditorChord, isTyping } from '../shortcuts'
import { fromEditorUi } from './hosted'
import { sendToScene } from './bus'

export function installHostedInput(): () => void {
  // Cmd/Ctrl+click in the viewport = editor pick, even while the scene plays.
  const onPointerDown = (e: PointerEvent): void => {
    if (!isMod(e) || e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return
    void sendToScene({ type: 'pick-at-pointer', add: e.shiftKey, toggle: e.altKey })
  }

  // The editor's own listeners sit on this same window and still run; only the
  // canvas below stops hearing the chord. Its key-up goes with it.
  const swallowed = new Set<string>()
  const onKey = (e: KeyboardEvent): void => {
    if (fromEditorUi(e) || isTyping(e)) return
    if (e.type === 'keyup') {
      if (swallowed.delete(e.code)) e.stopPropagation()
      return
    }
    if (!isEditorChord(e)) return
    swallowed.add(e.code)
    e.stopPropagation()
  }

  // the engine reports the pointer in these CSS pixels; its canvas can be larger.
  // Re-sent now and then: a restarted editor scene starts without it.
  let canvas: HTMLCanvasElement | null = null
  let sentAt = 0
  const measure = (): void => {
    if (canvas === null) return
    const { width, height } = canvas.getBoundingClientRect()
    sentAt = Date.now()
    void sendToScene({ type: 'pointer-space', width, height }).catch(() => (sentAt = 0))
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (!(e.target instanceof HTMLCanvasElement)) return
    const fresh = canvas !== e.target
    canvas = e.target
    if (fresh || Date.now() - sentAt > 1000) measure()
  }

  // closing or reloading the tab takes the engine session with it (and any
  // unsaved buffer): ask while a scene is open, saved or not
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    e.preventDefault()
  }

  // In a tab F5 reloads and Ctrl+S opens "Save page as", from a text field too.
  // Bubble phase: the editor's own handlers (Play, the Studio's save) run first.
  const onBrowserKey = (e: KeyboardEvent): void => {
    if (e.key === 'F5' || (isMod(e) && !e.altKey && e.code === 'KeyS')) e.preventDefault()
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('resize', measure)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onBrowserKey)
  return () => {
    window.removeEventListener('keydown', onBrowserKey)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('resize', measure)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}
