import { useEffect, useState } from 'react'
import { Button, IconButton } from '../../ds'
import { IconEdit } from '../../icons'
import { dataLayerReadFileBytes } from '../../engine/datalayer'
import { prefillAssistant } from '../../panels/ai-store'
import { projectDir } from '../../prefabs/library'
import { invalidateSceneCheckCache } from '../editor/scene-check-context'
import { announceThumbnailUsed, onThumbnailUsed, type BuiltThumbnail } from './built-thumbnails'

let inUse: Promise<string | null> | null = null

function currentThumbnail(): Promise<string | null> {
  const dir = projectDir()
  const read = window.editorShell?.sceneSettings
  if (dir === null || read === undefined) return Promise.resolve(null)
  inUse ??= read(dir).then((s) => s.thumbnailPath, () => null)
  return inUse
}

async function switchThumbnail(path: string): Promise<void> {
  const dir = projectDir()
  const shell = window.editorShell
  if (dir === null || shell?.sceneSettings === undefined || shell.saveSceneSettings === undefined) return
  const problem = await shell.saveSceneSettings(dir, { ...(await shell.sceneSettings(dir)), thumbnailPath: path })
  if (problem !== null) throw new Error(problem)
  invalidateSceneCheckCache()
  announceThumbnailUsed(path)
}

onThumbnailUsed((path) => { inUse = Promise.resolve(path) })

// A thumbnail version in the reply that painted it: switch the scene back to it, or ask for changes.
export function ThumbnailCard(props: { thumbnail: BuiltThumbnail }): JSX.Element {
  const { path, version } = props.thumbnail
  const [src, setSrc] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    dataLayerReadFileBytes(path).then((bytes) => {
      if (cancelled) return
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
      setSrc(url)
    }, () => setError('This version was deleted.'))
    return () => {
      cancelled = true
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [path])

  useEffect(() => {
    void currentThumbnail().then(setCurrent)
    return onThumbnailUsed(setCurrent)
  }, [])

  return (
    <div className="eui-ai-built eui-ai-thumb">
      {src !== null && <img src={src} alt={`Thumbnail version ${version}`} />}
      <div className="row">
        <div className="what">
          <b>Thumbnail {version}</b>
          <span>{error ?? (current === path ? 'In use · 1920×1080' : '1920×1080')}</span>
        </div>
        <div className="actions">
          {current !== path && error === null && (
            <Button onClick={() => void switchThumbnail(path).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}>
              Use this
            </Button>
          )}
          <IconButton tip="Make changes" aria-label={`Make changes to thumbnail ${version}`} onClick={() => prefillAssistant(`Change thumbnail ${version}: `)}>
            <IconEdit />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
