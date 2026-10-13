import css from './CardPicker.css?inline'
import { Checkbox } from '.'
import { registerCss } from './styles/registry'
import type { ReactNode } from 'react'

registerCss('ds/CardPicker', 'primitives', css)

export interface PickerItem {
  key: string
  label: string
  note?: string | null
  image?: string | null
  tip?: string
  disabledReason?: string | null
  // a small button beside the card, for a look before choosing
  preview?: { label: string; icon: ReactNode; onClick: () => void }
}

export function CardPicker(props: {
  items: PickerItem[]
  selected: string[]
  onSelect: (key: string) => void
  mode?: 'one' | 'many'
  ariaLabel: string
}): JSX.Element {
  const many = props.mode === 'many'
  const picked = new Set(props.selected)

  return (
    <div className="eui-ds-picks" role="group" aria-label={props.ariaLabel}>
      {props.items.map((it) => {
        const on = picked.has(it.key)
        const reason = it.disabledReason ?? null
        const image = it.image ?? null
        const note = it.note ?? null
        const tip = reason ?? it.tip
        const body = (
          <>
            {image === null ? (
              <span className="ph">⛶</span>
            ) : (
              <img src={image} alt="" crossOrigin="anonymous" loading="lazy" />
            )}
            <span className="meta">
              <span className="nm">{it.label}</span>
              {note !== null && <span className="num">{note}</span>}
            </span>
          </>
        )
        if (many) {
          return (
            <label key={it.key} className={`eui-ds-pick${on ? ' on' : ''}`} data-tip={tip}>
              <span className="box">
                <Checkbox checked={on} disabled={reason !== null} onChange={() => props.onSelect(it.key)} />
              </span>
              {body}
            </label>
          )
        }
        const pick = (
          <button
            key={it.key}
            type="button"
            className="eui-ds-pick"
            aria-pressed={on}
            disabled={reason !== null}
            data-tip={tip}
            onClick={() => props.onSelect(it.key)}
          >
            {body}
          </button>
        )
        if (it.preview === undefined) return pick
        return (
          <span key={it.key} className="eui-ds-pick-wrap">
            {pick}
            <button type="button" className="eui-ds-pick-preview" aria-label={it.preview.label} data-tip={it.preview.label} onClick={it.preview.onClick}>
              {it.preview.icon}
            </button>
          </span>
        )
      })}
    </div>
  )
}
