import type { ThreeReply, ThreeRequest } from './protocol'

// Builds run assistant code, so in a sandboxed frame of its own origin whose policy (inherited by the
// worker) allows no network. The preview runs none, and three's renderer hangs in that frame.
const POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src blob: data:; img-src blob: data:"
const FRAME = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><script>onmessage=(e)=>{const w=new Worker(URL.createObjectURL(new Blob([e.data],{type:'text/javascript'})));w.postMessage('build',[e.ports[0]])}</script>`

export interface ThreeWorker {
  postMessage: (request: ThreeRequest, transfer?: Transferable[]) => void
  onmessage: ((event: MessageEvent<ThreeReply>) => void) | null
  terminate: () => void
}

let source: (() => Promise<string>) | null = null

export function setThreeWorker(load: (() => Promise<string>) | null): void {
  source = load
}

export function threeAvailable(): boolean {
  return source !== null
}

export async function startThreeWorker(use: 'build' | 'view'): Promise<ThreeWorker> {
  if (source === null) throw new Error('3D tools are not available in this editor.')
  const code = await source()
  const channel = new MessageChannel()
  let stop: () => void
  let hand: (port: MessagePort) => void
  if (use === 'build') {
    const frame = document.createElement('iframe')
    frame.sandbox.add('allow-scripts')
    frame.hidden = true
    frame.srcdoc = FRAME
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
    document.body.appendChild(frame)
    await loaded
    stop = () => frame.remove()
    hand = (port) => frame.contentWindow?.postMessage(code, '*', [port])
  } else {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const worker = new Worker(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    stop = () => worker.terminate()
    hand = (port) => worker.postMessage('view', [port])
  }
  const ready = new Promise<void>((resolve, reject) => {
    channel.port1.onmessage = (event: MessageEvent<ThreeReply>) => { if (event.data.kind === 'ready') resolve() }
    setTimeout(() => reject(new Error('The 3D worker did not start.')), 15_000)
  })
  hand(channel.port2)
  await ready.catch((error: unknown) => {
    stop()
    throw error
  })
  const worker: ThreeWorker = {
    postMessage: (request, transfer = []) => channel.port1.postMessage(request, transfer),
    onmessage: null,
    terminate: () => {
      channel.port1.close()
      stop()
    }
  }
  channel.port1.onmessage = (event: MessageEvent<ThreeReply>) => worker.onmessage?.(event)
  return worker
}
