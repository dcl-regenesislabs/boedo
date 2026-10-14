// What a build reports, as data instead of log lines.
import type { PackageLock } from './packages/lock'
import type { PackageFiles } from './packages/mount'

export interface BuildDiagnostic {
  severity: 'error' | 'warning'
  message: string
  // project-relative path, when the problem has a source location
  file?: string
  line?: number
  column?: number
  lineText?: string
  // set when an import names a package that is not installed
  missingPackage?: string
}

export type BuildEvent =
  | { type: 'buildStarted'; buildId: number }
  | { type: 'diagnostics'; buildId: number; diagnostics: BuildDiagnostic[] }
  | { type: 'bundleSaved'; buildId: number; file: string; hash: string; bytes: number; ms: number }
  | { type: 'failed'; buildId: number; message: string }

export interface BuildOptions {
  // minified and without source maps, as `sdk-commands build --production`
  production?: boolean
}

export interface BuildResult {
  buildId: number
  ok: boolean
  // by project-relative path: the bundle, plus main.crdt when there is a composite
  outputs: Map<string, Uint8Array>
  diagnostics: BuildDiagnostic[]
  events: BuildEvent[]
  ms: number
}

export type ProjectFiles = ReadonlyMap<string, Uint8Array>

export type WorkerRequest =
  | { type: 'init'; wasmUrl: string; snapshotUrl: string; integrity?: { wasm: string; snapshot: string } }
  | { type: 'build'; buildId: number; files: [string, Uint8Array][]; options: BuildOptions }
  // the frozen packages every later build resolves imports from; null lock for none
  | { type: 'packages'; requestId: number; lock: PackageLock | null; files: PackageFiles }

export type WorkerResponse =
  | { type: 'ready'; sdkVersion: string; esbuildVersion: string; provided: Record<string, string> }
  | { type: 'initFailed'; message: string }
  | { type: 'event'; event: BuildEvent }
  | { type: 'result'; buildId: number; outputs: [string, Uint8Array][]; ms: number }
  | { type: 'packagesSet'; requestId: number; error?: string; packages: number; shadowed: string[] }
