import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CardPicker, type PickerItem } from '../../ds'
import { loadModelCatalog, modelById, opendclUrl } from '../../assets'
import { IconExpand } from '../../icons'
import { threeAvailable } from '../../three/client'
import { ModelPreview } from './ModelPreview'

const BUILD = 'build'
const MAX_MODELS = 4

// A ```models block in a reply: catalog ids the assistant offers, plus building one in code.
// Only ids the catalog knows become cards, so a reply can't show an arbitrary image.
export function ModelChoices(props: { source: string; question?: string; onChoose?: (text: string) => void }): JSX.Element {
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    void loadModelCatalog().catch(() => {}).finally(() => setReady(true))
  }, [])
  const ids = props.source.split(/[\s,]+/).filter(Boolean).slice(0, MAX_MODELS)
  const models = ready ? ids.flatMap((id) => modelById(id) ?? []) : []
  const closed = picked !== null ? 'Answered in the chat' : props.onChoose === undefined ? 'Only the latest reply can be answered' : null
  const items: PickerItem[] = [
    ...models.map((a) => ({
      key: a.id,
      label: a.name,
      note: a.width === undefined ? a.category : `${a.width.toFixed(1)} × ${(a.height ?? 0).toFixed(1)} × ${(a.depth ?? 0).toFixed(1)} m`,
      image: opendclUrl(a.thumbnailUrl) ?? null,
      disabledReason: closed,
      ...(threeAvailable() ? { preview: { label: `View ${a.name} in 3D`, icon: <IconExpand />, onClick: () => setViewing({ url: opendclUrl(a.url) ?? a.url, name: a.name }) } } : {})
    })),
    { key: BUILD, label: 'Build it in code', note: 'made for this scene', disabledReason: closed }
  ]
  const choose = (key: string): void => {
    setPicked(key)
    const asset = models.find((a) => a.id === key)
    const answer = asset === undefined ? 'Build it in code instead of using a catalog model.' : `Use the catalog model "${asset.name}" (id ${asset.id}).`
    // the question rides along: a reply restored after a reload starts a conversation that never saw it
    props.onChoose?.(props.question === undefined || props.question === '' ? answer : `${props.question} ${answer}`)
  }
  return (
    <>
      <CardPicker items={items} selected={picked === null ? [] : [picked]} onSelect={choose} mode="one" ariaLabel="Model choices" />
      <span ref={anchor} hidden />
      {/* out of the transcript: earlier replies are drawn faded, and the dialog would be too */}
      {viewing !== null && createPortal(
        <ModelPreview source={{ url: viewing.url }} name={viewing.name} onClose={() => setViewing(null)} />,
        anchor.current?.closest('.eui-root') ?? document.body
      )}
    </>
  )
}
