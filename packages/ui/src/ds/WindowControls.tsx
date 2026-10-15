import { Maximize2, Minus, X } from 'lucide-react'
import css from './WindowControls.css?inline'
import { registerCss } from './styles/registry'

registerCss('ds/WindowControls', 'primitives', css)

export interface WindowControlsProps {
  onClose: () => void
  closeLabel: string
  onMinimize?: () => void
  minimizeLabel?: string
  onExpand?: () => void
  expandLabel?: string
  expandIcon?: JSX.Element
}

export function WindowControls(props: WindowControlsProps): JSX.Element {
  const dot = (kind: 'close' | 'minimize' | 'expand', onClick: (() => void) | undefined, label: string, icon: JSX.Element): JSX.Element => (
    <button type="button" className={`eui-ds-winctl ${kind}`} aria-label={label} data-tip={label} disabled={onClick === undefined} onClick={onClick}>
      <span>{icon}</span>
    </button>
  )
  return (
    <div className="eui-ds-winctls" role="group" aria-label="Window controls">
      {dot('close', props.onClose, props.closeLabel, <X aria-hidden="true" />)}
      {dot('minimize', props.onMinimize, props.minimizeLabel ?? 'Minimize', <Minus aria-hidden="true" />)}
      {dot('expand', props.onExpand, props.expandLabel ?? 'Full screen', props.expandIcon ?? <Maximize2 aria-hidden="true" />)}
    </div>
  )
}
