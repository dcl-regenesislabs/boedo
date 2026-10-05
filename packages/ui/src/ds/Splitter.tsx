// A draggable, keyboard-operable divider between two stacked panels. `value` is
// the height of the panel BELOW it, so dragging up or ArrowUp grows that panel.
import type { KeyboardEvent, PointerEvent } from 'react'
import css from './Splitter.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/Splitter', 'primitives', css)

const STEP = 16
const BIG_STEP = 64

export function Splitter(props: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): JSX.Element {
  const { value, min, max, onChange } = props
  const clamp = (v: number): number => Math.round(Math.max(min, Math.min(max, v)))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = e.currentTarget
    const startY = e.clientY
    el.setPointerCapture(e.pointerId)
    el.dataset.dragging = ''
    const move = (ev: globalThis.PointerEvent): void => onChange(clamp(value + (startY - ev.clientY)))
    const up = (): void => {
      el.releasePointerCapture(e.pointerId)
      delete el.dataset.dragging
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? BIG_STEP : STEP
    const next =
      e.key === 'ArrowUp' ? value + step
        : e.key === 'ArrowDown' ? value - step
          : e.key === 'Home' ? max
            : e.key === 'End' ? min
              : null
    if (next === null) return
    e.preventDefault()
    onChange(clamp(next))
  }

  return (
    <div
      className="eui-ds-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label={props.label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-tip={`${props.label} — drag, or focus and use ↑ ↓`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
