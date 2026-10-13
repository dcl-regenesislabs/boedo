import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../ds'
import { IconEdit, IconExpand } from '../../icons'
import { prefillAssistant } from '../../panels/ai-store'
import { threeAvailable } from '../../three/client'
import type { BuiltModel } from './built-models'
import { ModelPreview } from './ModelPreview'

// A model the assistant built, in the reply that built it: look at it up close, or ask for changes.
export function BuiltModelCard(props: { model: BuiltModel }): JSX.Element {
  const [viewing, setViewing] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const { model } = props
  return (
    <div ref={anchor} className="eui-ai-built">
      <div className="what">
        <b>{model.name}</b>
        <span>{model.triangles.toLocaleString()} triangles · built in code</span>
      </div>
      <div className="actions">
        {threeAvailable() && (
          <IconButton tip="View in 3D" aria-label={`View ${model.name} in 3D`} onClick={() => setViewing(true)}>
            <IconExpand />
          </IconButton>
        )}
        <IconButton tip="Make changes" aria-label={`Make changes to ${model.name}`} onClick={() => prefillAssistant(`Change ${model.name}: `)}>
          <IconEdit />
        </IconButton>
      </div>
      {viewing && createPortal(
        <ModelPreview source={{ path: model.path }} name={model.name} onClose={() => setViewing(false)} />,
        anchor.current?.closest('.eui-root') ?? document.body
      )}
    </div>
  )
}
