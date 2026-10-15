import { useEffect, useRef, useState } from 'react'
import { Button, GroupLabel, Modal, PropRow, Spinner } from '../../ds'
import { startThreeWorker, type ThreeWorker } from '../../three/client'
import { catalogUrl } from '../../assets'
import { dataLayerReadFileBytes } from '../../engine/datalayer'
import { inspectModel } from '../../model-info'
import type { ThreeReply, ThreeRequest } from '../../three/protocol'

// A catalog model the creator can turn around before choosing it: thumbnails are too small to judge.
// The three.js worker draws it, so the page itself loads no 3D library.
// a catalog model by URL, or one of the project's files with the shared materials it points at
export type PreviewSource = { url: string } | { path: string }

type ModelInfo = ReturnType<typeof inspectModel>
const describe = (bytes: Uint8Array): ModelInfo | null => {
  try {
    return inspectModel(bytes)
  } catch {
    return null
  }
}

function Details(props: { info: ModelInfo; playing: string | null; onPlay: (name: string) => void }): JSX.Element {
  const { info } = props
  const size = info.bounds?.size
  const own = info.textures - info.sharedImages.length
  return (
    <div className="eui-ai-model-info">
      <GroupLabel>Model</GroupLabel>
      <PropRow label="Size">{size === undefined ? '—' : `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m`}</PropRow>
      <PropRow label="Triangles">{info.triangles.toLocaleString()}</PropRow>
      <PropRow label="File">{Math.round(info.bytes / 1024).toLocaleString()} KB</PropRow>
      <PropRow label="Materials">
        {info.materials.length}
        {info.materials.length > 0 && <small>{info.materials.join(', ')}</small>}
      </PropRow>
      <PropRow label="Textures">
        {own}
        {info.sharedImages.length > 0 ? ` + ${info.sharedImages.length} shared` : ''}
        {info.largestImage > 0 && <small>largest {info.largestImage} px</small>}
      </PropRow>
      {info.animations.length > 0 && (
        <>
          <GroupLabel>Animations</GroupLabel>
          <div className="clips">
            {info.animations.map((name) => (
              <Button key={name} size="xs" active={props.playing === name} aria-pressed={props.playing === name} onClick={() => props.onPlay(name)}>
                {name}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

async function load(source: PreviewSource): Promise<{ bytes: ArrayBuffer; files: Record<string, ArrayBuffer>; info: ModelInfo | null }> {
  if ('url' in source) {
    if (!catalogUrl(source.url)) throw new Error('not a catalog model')
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = await response.arrayBuffer()
    return { bytes, files: {}, info: describe(new Uint8Array(bytes)) }
  }
  const bytes = await dataLayerReadFileBytes(source.path)
  const dir = source.path.slice(0, source.path.lastIndexOf('/') + 1)
  const files: Record<string, ArrayBuffer> = {}
  for (const uri of inspectModel(bytes).sharedImages) {
    files[uri] = (await dataLayerReadFileBytes(new URL(uri, `file:///${dir}`).pathname.slice(1))).slice().buffer
  }
  return { bytes: bytes.slice().buffer, files, info: describe(bytes) }
}

export function ModelView(props: { source: PreviewSource }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const workerRef = useRef<ThreeWorker | null>(null)
  useEffect(() => {
    const el = host.current
    if (el === null) return
    // made here, not rendered: a canvas hands its drawing to a worker only once
    const canvas = document.createElement('canvas')
    el.appendChild(canvas)
    let worker: ThreeWorker | null = null
    let alive = true
    const send = (request: ThreeRequest, transfer: Transferable[] = []): void => worker?.postMessage(request, transfer)
    void (async () => {
      const { bytes, files, info: details } = await load(props.source)
      if (alive) {
        setInfo(details)
        setPlaying(details?.animations[0] ?? null)
      }
      worker = await startThreeWorker('view')
      workerRef.current = worker
      if (!alive) return worker.terminate()
      worker.onmessage = (event: MessageEvent<ThreeReply>) => setStatus(event.data.kind === 'shown' ? 'ready' : 'failed')
      const offscreen = canvas.transferControlToOffscreen()
      send({ kind: 'view', canvas: offscreen, bytes, files, width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio }, [offscreen, bytes, ...Object.values(files)])
    })().catch(() => alive && setStatus('failed'))
    canvas.onpointerdown = (event) => canvas.setPointerCapture(event.pointerId)
    canvas.onpointermove = (event) => { if (event.buttons !== 0) send({ kind: 'orbit', dx: event.movementX, dy: event.movementY }) }
    const zoom = (event: WheelEvent): void => {
      event.preventDefault()
      send({ kind: 'zoom', delta: event.deltaY })
    }
    canvas.addEventListener('wheel', zoom, { passive: false })
    const resize = new ResizeObserver(() => send({ kind: 'resize', width: el.clientWidth, height: el.clientHeight }))
    resize.observe(el)
    return () => {
      alive = false
      resize.disconnect()
      worker?.terminate()
      canvas.remove()
    }
  }, ['url' in props.source ? props.source.url : props.source.path])
  return (
    <div className="eui-ai-model-body">
      <div ref={host} className="eui-ai-model-view">
        {status === 'loading' && <Spinner size="md" />}
        {status === 'failed' && <p>The model could not be loaded.</p>}
        {status === 'ready' && <span className="hint">Drag to turn · scroll to zoom</span>}
      </div>
      {info !== null && (
        <Details info={info} playing={playing} onPlay={(name) => {
          setPlaying(name)
          workerRef.current?.postMessage({ kind: 'clip', name })
        }} />
      )}
    </div>
  )
}

export function ModelPreview(props: { source: PreviewSource; name: string; onClose: () => void }): JSX.Element {
  return (
    <Modal title={props.name} size="lg" closeX onClose={props.onClose}>
      <ModelView source={props.source} />
    </Modal>
  )
}
