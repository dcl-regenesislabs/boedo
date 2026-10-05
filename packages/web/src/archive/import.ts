// Bringing a project in from this computer: a .zip, or a folder (where the
// browser can pick one). This is how a desktop project gets here.
import { storablePath } from '../store/project-store'
import { parseSceneJson } from '../shell/scene-json'
import { externalDependencies } from './dependencies'
import { readZip } from './zip'

export interface ImportEntry {
  path: string
  // what the archive declares, known before anything is read
  size?: number
  read(): Promise<Uint8Array>
}

// the project service's own limits: a scene past them could not sync anyway
const IMPORT_LIMITS = { files: 2000, fileBytes: 50 * 1024 * 1024, totalBytes: 500 * 1024 * 1024 }
const MB = 1024 * 1024

export interface ImportPlan {
  title: string
  files: Map<string, Uint8Array>
  skipped: number
  warnings: string[]
  needsPackages: Record<string, string>
}

export type ImportOutcome = { ok: true; plan: ImportPlan } | { ok: false; reason: string }

// what archive tools and file managers add, which is no part of a project
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/
const SKIPPED_FOLDERS = new Set(['node_modules', '.git'])

const depth = (path: string): number => path.split('/').length

// Reads only what the project keeps: installed packages, build output, git
// history and env files are never opened.
export async function planImport(name: string, entries: ImportEntry[]): Promise<ImportOutcome> {
  const all = entries
    .map((entry) => ({ entry, path: entry.path.replace(/\\/g, '/').replace(/^(\.\/)+/, '') }))
    .filter(({ path }) => !JUNK.test(path))
  if (all.some(({ path }) => path === 'dcl-workspace.json')) {
    return { ok: false, reason: 'This is a workspace of several scenes. Import one scene folder at a time.' }
  }
  const sceneFiles = all
    .map(({ path }) => path)
    .filter((path) => (path === 'scene.json' || path.endsWith('/scene.json')) && !path.split('/').some((part) => SKIPPED_FOLDERS.has(part)))
    .sort((a, b) => depth(a) - depth(b))
  if (sceneFiles.length === 0) {
    return { ok: false, reason: 'There is no scene.json here, so this does not look like a Decentraland scene.' }
  }
  if (sceneFiles.length > 1 && depth(sceneFiles[0]) === depth(sceneFiles[1])) {
    return { ok: false, reason: 'There are several scenes here. Import one scene folder at a time.' }
  }
  // a zip of a folder holds the folder: the project starts where scene.json is
  const root = sceneFiles[0].slice(0, -'scene.json'.length)
  const inside = all.filter(({ path }) => path.startsWith(root)).map(({ entry, path }) => ({ entry, path: path.slice(root.length) }))

  const kept = inside.filter(({ path }) => storablePath(path))
  const refuse = (why: string): ImportOutcome => ({ ok: false, reason: `This scene is too large to import: ${why}.` })
  const overFile = (path: string): ImportOutcome => refuse(`${path} is larger than ${IMPORT_LIMITS.fileBytes / MB} MB`)
  const overTotal = (): ImportOutcome => refuse(`its files add up to more than ${IMPORT_LIMITS.totalBytes / MB} MB`)
  if (kept.length > IMPORT_LIMITS.files) return refuse(`it has more than ${IMPORT_LIMITS.files} files`)
  const big = kept.find(({ entry }) => (entry.size ?? 0) > IMPORT_LIMITS.fileBytes)
  if (big !== undefined) return overFile(big.path)
  if (kept.reduce((sum, { entry }) => sum + (entry.size ?? 0), 0) > IMPORT_LIMITS.totalBytes) return overTotal()

  const files = new Map<string, Uint8Array>()
  let total = 0
  for (const { entry, path } of kept) {
    // a folder's files declare no size up front
    const bytes = await entry.read()
    if (bytes.length > IMPORT_LIMITS.fileBytes) return overFile(path)
    total += bytes.length
    if (total > IMPORT_LIMITS.totalBytes) return overTotal()
    files.set(path, bytes)
  }
  const skipped = inside.length - kept.length

  const scene = parseSceneJson(files.get('scene.json'))
  if (scene === null) return { ok: false, reason: 'scene.json is not valid JSON.' }
  if (typeof scene.scene?.base !== 'string' || !Array.isArray(scene.scene.parcels)) {
    return { ok: false, reason: 'scene.json does not say which parcels the scene is on (scene.base and scene.parcels).' }
  }

  const warnings: string[] = []
  if (scene.runtimeVersion !== '7') {
    warnings.push('This is not an SDK7 scene (scene.json has no runtimeVersion "7"). The editor builds SDK7 scenes only, so it will most likely not run.')
  }
  if ([...files.keys()].some((path) => path.startsWith('server/'))) {
    warnings.push('This project has a server/ folder. The web editor does not run or publish a scene server: the files are kept, and nothing in them runs.')
  }
  // not a warning: the shell downloads and freezes them (shell/packages.ts)
  const needsPackages = externalDependencies(files.get('package.json'))
  const title = typeof scene.display?.title === 'string' && scene.display.title.trim() !== '' ? scene.display.title.trim() : name
  return { ok: true, plan: { title, files, skipped, warnings, needsPackages } }
}

export function zipEntries(bytes: Uint8Array): ImportEntry[] {
  return readZip(bytes)
}

interface PickedFile {
  kind: 'file'
  getFile(): Promise<File>
}
interface PickedFolder {
  kind: 'directory'
  name: string
  entries(): AsyncIterable<[string, PickedFile | PickedFolder]>
}

// A picked folder's files; node_modules and .git are not walked into.
export async function folderEntries(folder: PickedFolder, prefix = ''): Promise<ImportEntry[]> {
  const found: ImportEntry[] = []
  for await (const [name, handle] of folder.entries()) {
    if (handle.kind === 'file') {
      found.push({ path: prefix + name, read: async () => new Uint8Array(await (await handle.getFile()).arrayBuffer()) })
    } else if (!SKIPPED_FOLDERS.has(name)) {
      found.push(...(await folderEntries(handle, `${prefix}${name}/`)))
    }
  }
  return found
}

type FolderPicker = (options?: { mode?: 'read' }) => Promise<PickedFolder>

export function folderPicker(): FolderPicker | null {
  const picker = (window as { showDirectoryPicker?: FolderPicker }).showDirectoryPicker
  return typeof picker === 'function' ? picker.bind(window) : null
}
