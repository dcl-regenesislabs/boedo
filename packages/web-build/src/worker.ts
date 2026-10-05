// The build worker: owns the bundler and the SDK snapshot; builds run one at a time.
import * as esbuild from 'esbuild-wasm'
import type { BuildEvent, WorkerRequest, WorkerResponse } from './build-events'
import { mountPackages } from './packages/mount'
import { plainBytes } from './preview-ids'
import { SceneBuildSession } from './scene-build'
import type { SdkSnapshot } from './snapshot'
import { fetchVerified } from './verified-fetch'

declare const self: DedicatedWorkerGlobalScope

const post = (message: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(message, transfer)
const emit = (event: BuildEvent): void => post({ type: 'event', event })
const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', plainBytes(bytes)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// The bundler reaches its wasm through zero-delay timers, which browsers clamp
// to 4 ms when nested (builds ran ~3x slower); a message channel is not clamped.
function unclampZeroTimers(): void {
  const nativeSetTimeout = self.setTimeout.bind(self)
  const tasks: (() => void)[] = []
  const channel = new MessageChannel()
  channel.port1.onmessage = () => tasks.shift()?.()
  const fast = (handler: TimerHandler, delay?: number, ...args: unknown[]): number => {
    if (typeof handler !== 'function' || (delay !== undefined && delay > 0)) return nativeSetTimeout(handler, delay, ...args)
    tasks.push(() => handler(...args))
    channel.port2.postMessage(null)
    return 0
  }
  self.setTimeout = fast as typeof self.setTimeout
}

interface Started {
  session: SceneBuildSession
  snapshotNames: ReadonlySet<string>
}

async function start(request: Extract<WorkerRequest, { type: 'init' }>): Promise<Started> {
  unclampZeroTimers()
  const [wasm, response] = await Promise.all([
    fetchVerified(request.wasmUrl, request.integrity?.wasm, 'web-build/esbuild.wasm'),
    fetchVerified(request.snapshotUrl, request.integrity?.snapshot, 'web-build/sdk-snapshot.json')
  ])
  // compiled from the bytes just checked, never from a second request
  const wasmModule = await WebAssembly.compile(await wasm.arrayBuffer())
  const [, snapshot] = await Promise.all([esbuild.initialize({ wasmModule, worker: false }), response.json() as Promise<SdkSnapshot>])
  if (esbuild.version !== snapshot.meta.esbuildVersion) {
    throw new Error(`bundler ${esbuild.version} does not match the SDK's ${snapshot.meta.esbuildVersion}`)
  }
  const provided: Record<string, string> = {}
  for (const [name, { version }] of Object.entries(snapshot.meta.provided)) provided[name] = version
  post({ type: 'ready', sdkVersion: snapshot.meta.sdkVersion, esbuildVersion: esbuild.version, provided })
  return { session: new SceneBuildSession(esbuild, snapshot), snapshotNames: new Set(Object.keys(provided)) }
}

let engine: Promise<Started> | undefined
let queue: Promise<void> = Promise.resolve()

async function runBuild(request: Extract<WorkerRequest, { type: 'build' }>): Promise<void> {
  const { buildId } = request
  const started = performance.now()
  const elapsed = (): number => Math.round(performance.now() - started)
  emit({ type: 'buildStarted', buildId })
  let outputs = new Map<string, Uint8Array>()
  try {
    if (engine === undefined) throw new Error('build requested before init')
    const outcome = await (await engine).session.build(new Map(request.files), request.options)
    emit({ type: 'diagnostics', buildId, diagnostics: outcome.diagnostics })
    const bundle = outcome.bundleFile === undefined ? undefined : outcome.outputs.get(outcome.bundleFile)
    if (outcome.failure !== undefined || outcome.bundleFile === undefined || bundle === undefined) {
      emit({ type: 'failed', buildId, message: outcome.failure ?? 'The build produced no bundle' })
    } else {
      outputs = outcome.outputs
      emit({
        type: 'bundleSaved',
        buildId,
        file: outcome.bundleFile,
        hash: await sha256Hex(bundle),
        bytes: bundle.length,
        ms: elapsed()
      })
    }
  } catch (err) {
    emit({ type: 'failed', buildId, message: describe(err) })
  }
  const entries = [...outputs]
  post(
    { type: 'result', buildId, outputs: entries, ms: elapsed() },
    entries.map(([, bytes]) => bytes.buffer)
  )
}

async function usePackages(request: Extract<WorkerRequest, { type: 'packages' }>): Promise<void> {
  const { requestId } = request
  try {
    if (engine === undefined) throw new Error('packages sent before init')
    const { session, snapshotNames } = await engine
    const mounted = request.lock === null ? undefined : mountPackages(request.lock, request.files, snapshotNames)
    session.setPackages(mounted)
    post({ type: 'packagesSet', requestId, packages: mounted?.count ?? 0, shadowed: mounted?.shadowed ?? [] })
  } catch (err) {
    post({ type: 'packagesSet', requestId, error: describe(err), packages: 0, shadowed: [] })
  }
}

self.onmessage = (message: MessageEvent<WorkerRequest>) => {
  const request = message.data
  if (request.type === 'init') {
    engine = start(request)
    engine.catch((err: unknown) => post({ type: 'initFailed', message: describe(err) }))
  } else if (request.type === 'packages') {
    // in line with the builds: one sent after this sees these packages
    queue = queue.then(() => usePackages(request))
  } else {
    queue = queue.then(() => runBuild(request))
  }
}
