// The screen the editor's own panels leave to the scene, sent to the explorer (host setSceneInset), which
// reports it to scenes as their interactable area: a game's HUD then lays out clear of the editor.
import { useCallback, useRef } from 'react'
import { hostV1 } from '../engine/hosted'

export type InsetSide = 'left' | 'right' | 'top'

const elements = new Map<Element, InsetSide>()
let observer: ResizeObserver | null = null
let sent = ''
let queued = false

function measure(): void {
  queued = false
  const host = hostV1()
  if (host?.setSceneInset === undefined) return
  const area = { left: 0, top: 0, right: 0, bottom: 0 }
  for (const [el, side] of elements) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (side === 'left') area.left = Math.max(area.left, r.right)
    else if (side === 'right') area.right = Math.max(area.right, window.innerWidth - r.left)
    else area.top = Math.max(area.top, r.bottom)
  }
  const rounded = { left: Math.round(area.left), top: Math.round(area.top), right: Math.round(area.right), bottom: 0 }
  const key = JSON.stringify(rounded)
  if (key === sent) return
  sent = key
  host.setSceneInset(rounded)
}

function schedule(): void {
  if (queued) return
  queued = true
  queueMicrotask(measure)
}

function attach(el: HTMLElement, side: InsetSide): void {
  if (observer === null) {
    observer = new ResizeObserver(schedule)
    window.addEventListener('resize', schedule)
  }
  observer.observe(el)
  // a dragged toolbar moves without resizing
  el.addEventListener('transitionend', schedule)
  elements.set(el, side)
  schedule()
}

function detach(el: HTMLElement): void {
  observer?.unobserve(el)
  el.removeEventListener('transitionend', schedule)
  elements.delete(el)
  schedule()
}

/** A ref for a panel that covers the viewport from `side`; it counts while mounted and visible. */
export function useSceneInsetRef(side: InsetSide): (el: HTMLElement | null) => void {
  const current = useRef<HTMLElement | null>(null)
  return useCallback((el: HTMLElement | null) => {
    if (current.current !== null) detach(current.current)
    current.current = el
    if (el !== null) attach(el, side)
  }, [side])
}

/** Send again after a change no size observer sees: a panel moved, or the explorer switched to the editor's mode. */
export function remeasureSceneInset(): void {
  sent = ''
  schedule()
}
