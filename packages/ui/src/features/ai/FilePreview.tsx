import { useEffect, useState } from 'react'
import { Button, Modal, Spinner } from '../../ds'
import { dataLayerReadFileBytes } from '../../engine/datalayer'
import { baseName, fileKind, mimeFor, looksBinary, MAX_PREVIEW_BYTES } from '../../script/project-files'
import { threeAvailable } from '../../three/client'
import { ModelView } from './ModelPreview'

type Shown =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'audio' | 'video'; url: string }
  | { kind: 'none'; why: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function show(path: string, bytes: Uint8Array): { shown: Shown; url: string | null } {
  const kind = fileKind(path)
  if (kind === 'audio' || kind === 'video') {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeFor(path) }))
    return { shown: { kind, url }, url }
  }
  if (bytes.length > MAX_PREVIEW_BYTES) return { shown: { kind: 'none', why: `Too big to preview (${formatSize(bytes.length)}).` }, url: null }
  if (kind === 'image') {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeFor(path) }))
    return { shown: { kind, url }, url }
  }
  if (looksBinary(bytes)) return { shown: { kind: 'none', why: `Binary file (${formatSize(bytes.length)}) — nothing readable to show.` }, url: null }
  return { shown: { kind: 'text', text: new TextDecoder().decode(bytes) }, url: null }
}

function ModelFile(props: { path: string }): JSX.Element {
  if (!threeAvailable()) return <div className="eui-preview-msg">3D previews aren’t available in this editor.</div>
  return (
    <div className="eui-preview model">
      <ModelView source={{ path: props.path }} />
    </div>
  )
}

function BytesPreview(props: { path: string }): JSX.Element {
  const { path } = props
  const [shown, setShown] = useState<Shown | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let revoke: string | null = null
    setShown(null)
    setErr(null)

    dataLayerReadFileBytes(path).then(
      (bytes) => {
        if (!live) return
        const result = show(path, bytes)
        revoke = result.url
        setShown(result.shown)
      },
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e))
    )

    return () => {
      live = false
      if (revoke !== null) URL.revokeObjectURL(revoke)
    }
  }, [path])

  if (err !== null) return <div className="eui-preview-msg">Couldn’t read this file — {err}</div>
  if (shown === null)
    return (
      <div className="eui-preview-msg">
        <Spinner size="sm" /> Loading…
      </div>
    )
  if (shown.kind === 'none') return <div className="eui-preview-msg">{shown.why}</div>
  if (shown.kind === 'text')
    return (
      <div className="eui-preview">
        <pre className="eui-preview-text">{shown.text}</pre>
      </div>
    )
  if (shown.kind === 'image')
    return (
      <div className="eui-preview img">
        <img src={shown.url} alt={path} />
      </div>
    )
  if (shown.kind === 'audio')
    return (
      <div className="eui-preview media">
        <audio src={shown.url} controls aria-label={baseName(path)} />
      </div>
    )
  return (
    <div className="eui-preview media">
      <video src={shown.url} controls aria-label={baseName(path)} />
    </div>
  )
}

export function FilePreview(props: { path: string }): JSX.Element {
  return fileKind(props.path) === 'model' ? <ModelFile path={props.path} /> : <BytesPreview path={props.path} />
}

export function FilePreviewModal(props: { path: string; onClose: () => void; action?: { label: string; run: () => void } }): JSX.Element {
  const { action } = props
  const footer = action === undefined ? undefined : (
    <Button
      variant="primary"
      onClick={() => {
        action.run()
        props.onClose()
      }}
    >
      {action.label}
    </Button>
  )
  return (
    <Modal title={baseName(props.path)} size="lg" closeX onClose={props.onClose} footer={footer}>
      <div className="eui-preview-modal">
        <FilePreview path={props.path} />
      </div>
    </Modal>
  )
}
