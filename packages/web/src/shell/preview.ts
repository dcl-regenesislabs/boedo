// The open project's build loop: its files in memory, and each change turned
// into a build and a preview realm the engine can reload the scene from.
//
// Nothing here reloads the scene. The editor does, by id, when the running
// instance has to change: Play, Stop and a save in the code editor.
import type { ProjectPackages, SceneBuildEvent } from '@dcl-editor/contract'
import {
  LOCK_FILE,
  PREVIEW_CACHE_NAME,
  type BuildDiagnostic,
  type BuildOptions,
  type BuildResult,
  type BuilderInfo,
  type PackageStore,
  type SceneBuilder,
  createSceneBuilder,
  previewEntityId,
  previewManifestUrl,
  previewRealmUrl,
  publishPreview,
  serializeLock
} from '@dcl-editor/scene-compiler'
import { freezePackages } from './packages'
import { readKey, writeKey } from '@ui/core/persist'
import { parseSceneJson } from './scene-json'
import type { SceneCompilerFiles } from '../workers'

const REBUILD_DEBOUNCE_MS = 150
const MACHINE_ID_KEY = 'dcl-editor.machineId'

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Random per browser and never sent: previewMachineId derives the ids that are.
export function browserSecret(): string {
  const stored = readKey(MACHINE_ID_KEY)
  if (stored !== null && /^[A-Za-z0-9_.]{1,64}$/.test(stored)) return stored
  const id = 'w' + Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => byte.toString(36)).join('')
  writeKey(MACHINE_ID_KEY, id)
  return id
}

// The engine keys a scene's room on its entity id, which the comms gatekeeper sees signed by the
// wallet: one id per wallet and project, so two wallets on one browser can't be linked by it.
export async function previewMachineId(secret: string, wallet: string, projectId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}\n${wallet}\n${projectId}`))
  return 'w' + Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function diagnosticLine(d: BuildDiagnostic): string {
  const where = d.file === undefined ? '' : `${d.file}:${d.line ?? 1}:${d.column ?? 0}: `
  return `${where}${d.severity === 'error' ? 'ERROR' : 'WARNING'}: ${d.message}`
}

function summary(paths: string[]): string {
  return paths.length <= 3 ? paths.join(', ') : `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`
}

// One SDK release is pinned per editor version; a project made for another may not build the same.
function sdkPinWarning(files: ReadonlyMap<string, Uint8Array>, sdkVersion: string): string | null {
  const manifest = parseSceneJson(files.get('package.json'))
  for (const deps of [manifest?.devDependencies, manifest?.dependencies]) {
    const wanted = typeof deps === 'object' && deps !== null ? (deps as Record<string, unknown>)['@dcl/sdk'] : undefined
    if (typeof wanted === 'string' && wanted !== sdkVersion) {
      return `⚠ This project asks for @dcl/sdk ${wanted}; the editor builds it with ${sdkVersion}.`
    }
  }
  return null
}

export interface Preview {
  readonly id: string
  // the project as it is now; the owner writes a file here, then calls changed()
  readonly files: Map<string, Uint8Array>
  // first build: true when the realm serves this project's current files
  start(): Promise<boolean>
  flush(): Promise<boolean>
  // a build from before a failed one is still being served
  published(): Promise<boolean>
  changed(path: string): void
  stop(): void
}

export interface Previews {
  realmUrl(id: string): string
  // `realmId` names the preview realm; the project's own id keys its packages
  open(id: string, files: Map<string, Uint8Array>, realmId?: string): Preview
  // one build of the project's `files`, outside any preview: nothing is published or reported
  build(id: string, files: Map<string, Uint8Array>, options?: BuildOptions): Promise<BuildResult & { sdkVersion: string }>
  // download and freeze what the project's package.json asks for, ahead of its first build
  install(id: string, files: Map<string, Uint8Array>): Promise<void>
  dispose(): void
}

export function createPreviews(options: {
  pageDir: string
  urls: SceneCompilerFiles
  machineId: (projectId: string) => Promise<string>
  emit: (event: SceneBuildEvent) => void
  log: (line: string) => void
  // the device's npm packages (store/package-store.ts)
  packages: PackageStore
  // keep the project's new lock file
  saveLock: (id: string, bytes: Uint8Array) => Promise<void>
  onPackages: (id: string, status: ProjectPackages | null) => void
}): Previews {
  const { emit, log } = options
  // started on the first build: the bundler and the SDK snapshot are 16 MB
  let builder: SceneBuilder | null = null
  let disposed = false
  // the lock whose packages the build worker holds; '' for none, null for a new worker
  let mounted: string | null = null
  // the worker holds one project's packages: installs and builds take turns
  let turn: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = turn.then(work, work)
    turn = run.catch(() => {})
    return run
  }

  async function sdk(): Promise<{ builder: SceneBuilder; sdkVersion: string; info: BuilderInfo }> {
    if (disposed) throw new Error('The editor was closed')
    if (builder === null) mounted = null
    const started = builder ?? createSceneBuilder(options.urls)
    builder = started
    try {
      const info = await started.ready
      return { builder: started, sdkVersion: info.sdkVersion, info }
    } catch (error) {
      // a worker that failed to start stays dead: the next build gets a new one
      started.dispose()
      if (builder === started) builder = null
      throw error
    }
  }

  // Freezes the project's packages and hands them to the build worker. `say`
  // false keeps a project that is not open out of the open one's log.
  async function mount(id: string, files: Map<string, Uint8Array>, say: boolean): Promise<void> {
    const { builder: bundler, info } = await sdk()
    let announced = false
    const frozen = await freezePackages(files, options.packages, info.snapshot, (status) => {
      options.onPackages(id, status)
      if (say && !announced) log('Downloading packages from npm…')
      announced = true
    })
    if (frozen.lockFile !== undefined) {
      files.set(LOCK_FILE, frozen.lockFile)
      await options.saveLock(id, frozen.lockFile)
    }
    const key = frozen.lock === null ? '' : serializeLock(frozen.lock)
    if (key !== mounted) {
      try {
        await bundler.setPackages(frozen.lock, options.packages)
        mounted = key
      } catch (error) {
        if (say) log(`⚠ ${describe(error)}`)
        await bundler.setPackages(null)
        mounted = ''
      }
    }
    options.onPackages(id, frozen.status)
    if (!say || frozen.status === null) return
    if (frozen.status.state === 'error') log(`✖ ${frozen.status.message ?? 'The packages could not be installed'}`)
    else if (frozen.downloaded > 0) {
      const names = Object.entries(frozen.status.installed).map(([name, version]) => `${name} ${version}`)
      log(`✔ Packages frozen into the scene: ${names.join(', ')} (${frozen.status.total} in all)`)
    }
    for (const warning of frozen.status.warnings) log(`⚠ ${warning}`)
  }

  function open(id: string, files: Map<string, Uint8Array>, realmId = id): Preview {
    const realmUrl = previewRealmUrl(options.pageDir, realmId)
    const dirty = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let running: Promise<boolean> | null = null
    let initial = true
    let lastOk = false
    let stopped = false
    // what the worker held after this project's last mount
    let mountedHere: string | null = null

    const fail = (message: string): false => {
      emit({ type: 'failed', message })
      log(`✖ Build failed: ${message.split('\n')[0]}`)
      return false
    }

    async function cycle(changed: string[]): Promise<boolean> {
      const started = performance.now()
      emit({ type: 'buildStarted', changed })
      log(changed.length === 0 ? 'Building the scene…' : `Rebuilding: ${summary(changed)}`)
      try {
        const { builder: bundler, sdkVersion } = await sdk()
        const pin = changed.length === 0 ? sdkPinWarning(files, sdkVersion) : null
        if (pin !== null) log(pin)
        const repack = changed.length === 0 || changed.includes('package.json') || changed.includes(LOCK_FILE)
        const { snapshot, result } = await inTurn(async () => {
          // another project's build may have left its packages in the worker
          if (repack || mounted !== mountedHere) {
            await mount(id, files, true)
            mountedHere = mounted
          }
          const snapshot = new Map(files)
          return { snapshot, result: await bundler.build(snapshot) }
        })
        if (stopped) return false
        // a warning about one of the SDK's own files is not the creator's to fix
        const diagnostics = result.diagnostics.filter(
          (d) => d.severity === 'error' || d.file === undefined || snapshot.has(d.file)
        )
        emit({
          type: 'diagnostics',
          diagnostics: diagnostics.map(({ severity, message, file, line, column }) => ({ severity, message, file, line, column }))
        })
        for (const diagnostic of diagnostics) log(diagnosticLine(diagnostic))
        if (!result.ok) {
          const failure = result.events.find((event) => event.type === 'failed')
          return fail(failure?.type === 'failed' ? failure.message : 'The build produced no bundle')
        }
        const sceneJson = parseSceneJson(snapshot.get('scene.json'))
        if (sceneJson === null) return fail('scene.json is missing or is not valid JSON')
        await publishPreview({
          realmUrl,
          projectId: realmId,
          files: snapshot,
          buildOutputs: result.outputs,
          sceneJson,
          sdkVersion,
          machineId: await options.machineId(realmId)
        })
        if (stopped) return false
        emit({ type: 'bundleSaved' })
        log(`✔ Built in ${Math.round(performance.now() - started)} ms`)
        return true
      } catch (error) {
        return stopped ? false : fail(describe(error))
      }
    }

    function drain(): Promise<boolean> {
      if (stopped) return Promise.resolve(false)
      if (running !== null) return running
      running = (async () => {
        while ((initial || dirty.size > 0) && !stopped) {
          const paths = initial ? [] : [...dirty]
          initial = false
          dirty.clear()
          lastOk = await cycle(paths)
        }
        return lastOk && !stopped
      })().finally(() => { running = null })
      return running
    }

    return {
      id,
      files,
      start: drain,
      flush() {
        if (timer !== null) clearTimeout(timer)
        timer = null
        return drain()
      },
      async published() {
        const stored = await (await caches.open(PREVIEW_CACHE_NAME)).match(previewManifestUrl(realmUrl))
        const manifest: unknown = await stored?.json().catch(() => undefined)
        const entity = (manifest as { entity?: { id?: unknown } } | undefined)?.entity
        return entity?.id === previewEntityId(realmId, await options.machineId(realmId))
      },
      changed(path) {
        if (stopped) return
        dirty.add(path)
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void drain()
        }, REBUILD_DEBOUNCE_MS)
      },
      stop() {
        stopped = true
        if (timer !== null) clearTimeout(timer)
      }
    }
  }

  return {
    realmUrl: (id) => previewRealmUrl(options.pageDir, id),
    open,
    async build(id, files, buildOptions) {
      const { builder: bundler, sdkVersion } = await sdk()
      return inTurn(async () => {
        await mount(id, files, false)
        return { ...(await bundler.build(files, buildOptions)), sdkVersion }
      })
    },
    install: (id, files) => inTurn(() => mount(id, files, false)),
    dispose() {
      disposed = true
      builder?.dispose()
      builder = null
    }
  }
}
