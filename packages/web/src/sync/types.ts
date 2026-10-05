// The sync engine's vocabulary: what it remembers per project, what it is given,
// and what it offers the shell.
import type { ProjectSyncState, SyncConflictChoice, SyncStatus } from '@dcl-editor/contract'
import type { ProjectStore } from '../store/project-store'
import type { ManifestFiles, ProjectsApi } from './api'
import type { Progress } from './transfer'

export const PUSH_DEBOUNCE_MS = 2000
export const RETRY_BASE_MS = 2000
export const RETRY_MAX_MS = 60_000
// opening a project waits this long for the service to say whether it moved on
export const OPEN_CHECK_MS = 4000
export const LIST_FRESH_MS = 5000
// a file that keeps changing under its upload is given up on after this many tries
export const MOVED_TRIES = 3

export interface SyncRecord {
  // the account this copy belongs to, lowercased
  wallet: string
  baseVersion: number
  base: ManifestFiles
  pending: string[]
  // the service has this project in its trash because it was deleted here
  remoteDeleted: boolean
}

export interface SyncSession {
  api: ProjectsApi
  wallet: string
}

export interface SyncEngineOptions {
  store: ProjectStore
  // null: a guest, or a page with no project service
  session: () => SyncSession | null
  // why there is no session
  account: () => SyncStatus['account']
  hash: (bytes: Uint8Array) => Promise<string>
  // the name the account lists the project under
  title: (id: string) => Promise<string>
  // "keep both": copy the project as it is here; resolves the copy's id
  duplicate: (id: string) => Promise<string>
}

export interface RemoteOnlyProject {
  id: string
  name: string
  updatedAt: number
}

export interface SyncEngine {
  status(): SyncStatus
  subscribe(listener: (status: SyncStatus) => void): () => void
  // on the account and not on this device
  remoteOnly(): RemoteOnlyProject[]
  // ids the account already uses, for naming a new project
  remoteIds(): string[]
  // the project's files by content hash, hashing only what changed since the last copy
  manifest(id: string): Promise<ManifestFiles>
  // the home screen loaded, or the account changed: compare with the account
  refresh(force?: boolean): Promise<void>
  // a project file was written or removed
  touched(id: string, path: string): void
  // push what is waiting now: the project is closing or the page is being hidden
  flush(id?: string): Promise<void>
  // before a project opens: download it, or bring it up to the account's version
  prepareOpen(id: string, progress?: Progress): Promise<void>
  resolve(id: string, choice: SyncConflictChoice): Promise<void>
  trashed(id: string): void
  restored(id: string): void
  // resolves when nothing is in flight
  idle(): Promise<void>
  dispose(): void
}

export interface Tracked {
  loaded: Promise<void>
  record: SyncRecord | null
  pending: Set<string>
  busy: number
  progress?: { done: number; total: number }
  conflict: boolean
  // remote is ahead and nothing here changed: waiting to be brought up to date
  behind: boolean
  error: string | null
  attempt: number
  moved: number
  retry: ReturnType<typeof setTimeout> | null
  debounce: ReturnType<typeof setTimeout> | null
  chain: Promise<unknown>
  saving: Promise<unknown>
  // when this session last agreed a version with the service, on the engine's clock
  agreedAt: number
}

export const ATTENTION: ProjectSyncState[] = ['conflict', 'error', 'offline', 'syncing', 'synced', 'local']

export const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function isRecord(value: unknown): value is SyncRecord {
  const record = value as Partial<SyncRecord> | null
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof record.wallet === 'string' &&
    typeof record.baseVersion === 'number' &&
    typeof record.base === 'object' &&
    record.base !== null &&
    Array.isArray(record.pending)
  )
}
