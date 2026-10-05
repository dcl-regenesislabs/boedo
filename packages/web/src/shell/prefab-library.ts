// The cross-scene prefab library in the browser: the built-ins shipped next to
// editor.js and, signed in, the wallet's own library on the project service.
// Placing copies a library folder into the open project's custom/<slug>/, with
// the desktop app's rules (packages/desktop/src/prefab-library.ts): one copy per
// prefab id, `~runtime/` resolved on the way in, and an update that keeps what
// the creator added but drops what the last master shipped and this one does not.
import type { PrefabCopyResult, PrefabLibraryEntry, PrefabLibraryScope } from '@dcl-editor/contract'
import { slugify } from '@ui/prefabs/format'
import { ORIGIN_HASHES_FILE, parseOriginHashes } from '@ui/prefabs/versioning'

export interface LibraryFolder {
  name: string
  // data.json, verbatim
  data: string
  // path relative to the folder -> size
  files: Readonly<Record<string, number>>
}

export interface LibraryTree {
  folders(): Promise<LibraryFolder[]>
  read(folder: LibraryFolder, rel: string): Promise<Uint8Array>
}

// The open project, as the copy sees and changes it.
export interface ProjectFiles {
  files(): ReadonlyMap<string, Uint8Array>
  write(path: string, bytes: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
}

const PROJECT_PREFAB_DIR = 'custom'
const PROJECT_RUNTIME_DIR = 'src/scripts/runtime'
const SCRIPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const MAX_THUMBNAIL_BYTES = 300 * 1024

export function prefabSlug(name: string): string {
  return slugify(name) || 'prefab'
}

export function parseRef(ref: string): { scope: PrefabLibraryScope; name: string } | null {
  const i = ref.indexOf(':')
  const scope = ref.slice(0, i)
  const name = ref.slice(i + 1)
  if (i < 0 || (scope !== 'user' && scope !== 'builtin')) return null
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..') ? { scope, name } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseData(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function prefabName(data: Record<string, unknown> | null, fallback: string): string {
  return typeof data?.name === 'string' && data.name.trim() !== '' ? data.name : fallback
}

// a pinned `slug` keeps the folder that scripts and guides quote, whatever the card is called
function installSlug(data: Record<string, unknown> | null, name: string): string {
  const pinned = typeof data?.slug === 'string' ? prefabSlug(data.slug) : ''
  return pinned !== '' && pinned !== 'prefab' ? pinned : prefabSlug(name)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function projectFolders(files: ReadonlyMap<string, Uint8Array>): Set<string> {
  const folders = new Set<string>()
  for (const path of files.keys()) {
    const [root, name, rest] = path.split('/', 3)
    if (root === PROJECT_PREFAB_DIR && name !== undefined && rest !== undefined) folders.add(name)
  }
  return folders
}

function projectFolderForId(files: ReadonlyMap<string, Uint8Array>, id: unknown): string | null {
  if (typeof id !== 'string' || id === '') return null
  for (const name of projectFolders(files)) {
    const bytes = files.get(`${PROJECT_PREFAB_DIR}/${name}/data.json`)
    if (bytes !== undefined && parseData(new TextDecoder().decode(bytes))?.id === id) return `${PROJECT_PREFAB_DIR}/${name}`
  }
  return null
}

function freeFolder(files: ReadonlyMap<string, Uint8Array>, base: string): string {
  const taken = projectFolders(files)
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
  return `${PROJECT_PREFAB_DIR}/${name}`
}

// The same rewrite as the desktop app's, so a copy lands byte-identical there and here.
function resolveRuntimeAlias(bytes: Uint8Array, folder: string, rel: string): Uint8Array {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return bytes
  }
  const depth = `${folder}/${rel}`.split('/').slice(0, -1).filter((seg) => seg !== '').length
  const prefix = `${'../'.repeat(depth)}${PROJECT_RUNTIME_DIR}/`
  const resolved = text.replace(/\b(from|import)\s*(['"])~runtime\/([^'"\n]+)\2/g, (_m, keyword: string, quote: string, rest: string) =>
    `${keyword} ${quote}${prefix}${rest}${quote}`
  )
  return resolved === text ? bytes : new TextEncoder().encode(resolved)
}

export function createPrefabLibrary(trees: { builtin: LibraryTree; user: () => LibraryTree | null }) {
  const treeOf = (scope: PrefabLibraryScope): LibraryTree | null => (scope === 'builtin' ? trees.builtin : trees.user())

  async function find(ref: string): Promise<{ tree: LibraryTree; folder: LibraryFolder } | null> {
    const parsed = parseRef(ref)
    const tree = parsed === null ? null : treeOf(parsed.scope)
    if (parsed === null || tree === null) return null
    const folder = (await tree.folders()).find((candidate) => candidate.name === parsed.name)
    return folder === undefined ? null : { tree, folder }
  }

  async function thumbnail(tree: LibraryTree, folder: LibraryFolder): Promise<string | undefined> {
    const size = folder.files['thumbnail.png']
    if (size === undefined || size > MAX_THUMBNAIL_BYTES) return undefined
    try {
      return `data:image/png;base64,${toBase64(await tree.read(folder, 'thumbnail.png'))}`
    } catch {
      return undefined
    }
  }

  async function entries(scope: PrefabLibraryScope, tree: LibraryTree): Promise<PrefabLibraryEntry[]> {
    const listed = (await tree.folders()).filter((folder) => parseData(folder.data) !== null)
    // a builtin being reworked ships hidden: scenes that placed it keep it, the library stops offering it
    const shown = scope === 'builtin' ? listed.filter((folder) => parseData(folder.data)?.hidden !== true) : listed
    return Promise.all(
      shown.map(async (folder) => {
        const image = await thumbnail(tree, folder)
        return { ref: `${scope}:${folder.name}`, scope, data: folder.data, ...(image === undefined ? {} : { thumbnail: image }) }
      })
    )
  }

  // Every master file first, then the writes: a fetch that fails leaves the project as it was.
  async function land(tree: LibraryTree, src: LibraryFolder, dest: string, project: ProjectFiles): Promise<void> {
    const incoming = new Map<string, Uint8Array>()
    for (const rel of Object.keys(src.files)) {
      const bytes = await tree.read(src, rel)
      incoming.set(rel, SCRIPT_EXT.test(rel) ? resolveRuntimeAlias(bytes, dest, rel) : bytes)
    }
    const prefix = `${dest}/`
    const files = project.files()
    const manifest = files.get(`${prefix}${ORIGIN_HASHES_FILE}`)
    const shipped = manifest === undefined ? null : parseOriginHashes(new TextDecoder().decode(manifest))
    // with no manifest nothing proves a file was the master's, so it stays
    const dropped = [...files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((rel) => !incoming.has(rel) && shipped !== null && rel in shipped)
    for (const [rel, bytes] of incoming) await project.write(`${prefix}${rel}`, bytes)
    for (const rel of dropped) await project.remove(`${prefix}${rel}`)
  }

  return {
    async list(): Promise<PrefabLibraryEntry[]> {
      const builtins = await entries('builtin', trees.builtin)
      const user = trees.user()
      if (user === null) return builtins
      try {
        return [...builtins, ...(await entries('user', user))]
      } catch (error) {
        console.warn('[editor] your prefab library could not be read', error)
        return builtins
      }
    },

    async copyIn(ref: string, project: ProjectFiles): Promise<PrefabCopyResult | null> {
      const found = await find(ref)
      if (found === null || !project.files().has('scene.json')) return null
      const data = parseData(found.folder.data)
      const name = prefabName(data, found.folder.name)
      const existing = projectFolderForId(project.files(), data?.id)
      if (existing !== null) return { folder: existing, name, reused: true }
      const folder = freeFolder(project.files(), installSlug(data, name))
      await land(found.tree, found.folder, folder, project)
      return { folder, name, reused: false }
    },

    async updateCopy(ref: string, project: ProjectFiles): Promise<string | null> {
      const found = await find(ref)
      if (found === null) return null
      const existing = projectFolderForId(project.files(), parseData(found.folder.data)?.id)
      if (existing === null) return null
      await land(found.tree, found.folder, existing, project)
      return existing
    }
  }
}
