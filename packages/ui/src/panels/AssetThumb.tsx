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
