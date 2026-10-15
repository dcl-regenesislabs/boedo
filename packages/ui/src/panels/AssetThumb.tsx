import { useEffect, useState } from 'react'
import { dataLayerReadFileBytes } from '../engine/datalayer'
import { log } from '../log'
import { MAX_PREVIEW_BYTES, mimeFor } from '../script/project-files'

export function AssetThumb(props: { path: string; fallback: JSX.Element }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let made: string | null = null
    dataLayerReadFileBytes(props.path).then(
      (bytes) => {
        if (!live || bytes.length > MAX_PREVIEW_BYTES) return
        made = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeFor(props.path) }))
        setUrl(made)
      },
      (e: unknown) => log.debug('thumbnail unreadable', props.path, e)
    )
    return () => {
      live = false
      if (made !== null) URL.revokeObjectURL(made)
    }
  }, [props.path])
  return url === null ? props.fallback : <img className="eui-asset-thumb" src={url} alt="" />
}

export const ModelGlyph = (): JSX.Element => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 2.5 21 7v10l-9 4.5L3 17V7l9-4.5Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M3 7l9 4.5L21 7M12 11.5V21.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)
