// Page-side handle on the build worker.
import type { BuildEvent, BuildOptions, BuildResult, ProjectFiles, WorkerRequest, WorkerResponse } from './build-events'
import type { PackageLock } from './packages/lock'
import type { PackageFiles } from './packages/mount'
import type { SnapshotPackages } from './packages/types'
import { PACKAGE_RECEIPT, type PackageStore, readReceipt } from './packages/store'
import { fetchVerified } from './verified-fetch'

export interface SceneBuilderOptions {
  // where the files of this package's dist/ are served
  workerUrl: string | URL
  wasmUrl: string | URL
  snapshotUrl: string | URL
  // sha384 SRI per file: each is fetched held to it, and the worker starts from the checked text
  integrity?: { worker: string; wasm: string; snapshot: string }
  // every event of every build, as it happens
  onEvent?: (event: BuildEvent) => void
}

export interface BuilderInfo {
  sdkVersion: string
  esbuildVersion: string
  // what resolveDependencies must leave to the SDK snapshot
  snapshot: SnapshotPackages
}

export interface PackagesInUse {
  packages: number
  files: number
  bytes: number
  // locked packages left out because the SDK snapshot owns their name
  shadowed: string[]
}

export interface SceneBuilder {
  // resolves once the bundler and the SDK snapshot are loaded
  ready: Promise<BuilderInfo>
  build(files: ProjectFiles, options?: BuildOptions): Promise<BuildResult>
  // Hands the builds the project's frozen packages, read from the store; null for none.
  // Rejects when the store does not hold exactly what the lock pins.
  setPackages(lock: PackageLock | null, store?: PackageStore): Promise<PackagesInUse>
  dispose(): void
}

// everything the bundler can load; models, textures and sounds stay on the page
const BUILD_INPUT = /\.(tsx?|mts|cts|jsx?|mjs|cjs|json|composite|css|txt)$/
const DECLARATION = /\.d\.[mc]?ts$/

function previousBundle(files: ProjectFiles): string | undefined {
  const sceneJson = files.get('scene.json')
  if (sceneJson === undefined) return undefined
  try {
    const main: unknown = JSON.parse(new TextDecoder().decode(sceneJson)).main
    return typeof main === 'string' ? main : undefined
  } catch {
    return undefined
  }
}

async function startWorker(options: SceneBuilderOptions): Promise<Worker> {
  const { integrity } = options
  if (integrity === undefined) return new Worker(options.workerUrl)
  const url = new URL(options.workerUrl, location.href).href
  const text = await (await fetchVerified(url, integrity.worker, 'scene-compiler/worker.js')).text()
  // a blob is on the page's origin, so a worker served from a CDN can start from it
  const blob = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
  const worker = new Worker(blob)
  setTimeout(() => URL.revokeObjectURL(blob), 60_000)
  return worker
}

export function createSceneBuilder(options: SceneBuilderOptions): SceneBuilder {
  const started = startWorker(options)
  // posted in order once the worker exists
  const send = (request: WorkerRequest): void => void started.then((worker) => worker.postMessage(request), () => {})
  const pending = new Map<number, { events: BuildEvent[]; resolve: (result: BuildResult) => void }>()
  let nextBuildId = 1
  const awaitingPackages = new Map<number, { resolve: (shadowed: string[]) => void; reject: (reason: Error) => void }>()
  let nextRequestId = 1
  let settleReady: (info: BuilderInfo) => void = () => {}
  let rejectReady: (reason: Error) => void = () => {}
  const ready = new Promise<BuilderInfo>((resolve, reject) => {
    settleReady = resolve
    rejectReady = reject
  })

  const failAll = (message: string): void => {
    rejectReady(new Error(message))
    for (const [buildId, build] of pending) {
      const event: BuildEvent = { type: 'failed', buildId, message }
      options.onEvent?.(event)
      build.resolve({ buildId, ok: false, outputs: new Map(), diagnostics: [], events: [...build.events, event], ms: 0 })
    }
    pending.clear()
    for (const request of awaitingPackages.values()) request.reject(new Error(message))
    awaitingPackages.clear()
  }

  const onMessage = (message: MessageEvent<WorkerResponse>): void => {
    const response = message.data
    if (response.type === 'ready') {
      settleReady({
        sdkVersion: response.sdkVersion,
        esbuildVersion: response.esbuildVersion,
        snapshot: { sdkVersion: response.sdkVersion, provided: response.provided }
      })
    } else if (response.type === 'packagesSet') {
      const request = awaitingPackages.get(response.requestId)
      awaitingPackages.delete(response.requestId)
      if (response.error === undefined) request?.resolve(response.shadowed)
      else request?.reject(new Error(response.error))
    } else if (response.type === 'initFailed') {
      failAll(response.message)
    } else if (response.type === 'event') {
      pending.get(response.event.buildId)?.events.push(response.event)
      options.onEvent?.(response.event)
    } else {
      const build = pending.get(response.buildId)
      if (build === undefined) return
      pending.delete(response.buildId)
      build.resolve({
        buildId: response.buildId,
        ok: build.events.some((event) => event.type === 'bundleSaved'),
        outputs: new Map(response.outputs),
        diagnostics: build.events.flatMap((event) => (event.type === 'diagnostics' ? event.diagnostics : [])),
        events: build.events,
        ms: response.ms
      })
    }
  }

  started.then(
    (worker) => {
      worker.onerror = (event) => failAll(event.message || 'The build worker failed to start')
      worker.onmessage = onMessage
    },
    (error: unknown) => failAll(error instanceof Error ? error.message : String(error))
  )
  const { integrity } = options
  send({
    type: 'init',
    wasmUrl: new URL(options.wasmUrl, location.href).href,
    snapshotUrl: new URL(options.snapshotUrl, location.href).href,
    integrity: integrity === undefined ? undefined : { wasm: integrity.wasm, snapshot: integrity.snapshot }
  })
  ready.catch(() => {})

  return {
    ready,
    build(files, buildOptions = {}) {
      const buildId = nextBuildId++
      const stale = previousBundle(files)
      const inputs = [...files].filter(([path]) => BUILD_INPUT.test(path) && path !== stale)
      return new Promise((resolve) => {
        pending.set(buildId, { events: [], resolve })
        send({ type: 'build', buildId, files: inputs, options: buildOptions })
      })
    },
    async setPackages(lock, store) {
      const files: PackageFiles = []
      let bytes = 0
      for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
        const receipt = store === undefined ? undefined : await readReceipt(store, key)
        if (store === undefined || receipt?.integrity !== entry.integrity) throw new Error(`${key} is not in the package store`)
        for (const path of await store.list(key)) {
          if (!BUILD_INPUT.test(path) || DECLARATION.test(path) || path === PACKAGE_RECEIPT) continue
          const content = await store.read(key, path)
          if (content === undefined) throw new Error(`${key} is incomplete in the package store: ${path}`)
          files.push([key, path, content])
          bytes += content.length
        }
      }
      const requestId = nextRequestId++
      const shadowed = await new Promise<string[]>((resolve, reject) => {
        awaitingPackages.set(requestId, { resolve, reject })
        send({ type: 'packages', requestId, lock, files })
      })
      return { packages: Object.keys(lock?.packages ?? {}).length - shadowed.length, files: files.length, bytes, shadowed }
    },
    dispose() {
      void started.then((worker) => worker.terminate(), () => {})
      failAll('The scene builder was disposed')
    }
  }
}
