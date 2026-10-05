// Reading and merge-writing a project's scene.json and main.composite. These
// mirror desktop's scene-settings.ts, scene-meta.ts and composite-entities.ts:
// that package reads through node:fs and is not a dependency of this one.
import type { SceneSettings, SpawnPointSetting } from '@dcl-editor/contract'

export const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

type Axis = number | number[]
interface RawSpawnPoint {
  name?: string
  default?: boolean
  position?: { x?: Axis; y?: Axis; z?: Axis }
  cameraTarget?: { x?: Axis; y?: Axis; z?: Axis }
}

// scene.json as parsed: everything optional, everything else preserved
export interface RawSceneJson {
  display?: { title?: string; description?: string; navmapThumbnail?: string; [k: string]: unknown }
  contact?: { name?: string; email?: string; [k: string]: unknown }
  scene?: { parcels?: string[]; base?: string; [k: string]: unknown }
  spawnPoints?: RawSpawnPoint[]
  worldConfiguration?: { name?: string; [k: string]: unknown }
  [k: string]: unknown
}

// Any JSON object file of a project; null when missing or not an object.
export function parseSceneJson(bytes: Uint8Array | undefined): RawSceneJson | null {
  if (bytes === undefined) return null
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as RawSceneJson) : null
  } catch {
    return null
  }
}

export const sceneJsonBytes = (raw: RawSceneJson): Uint8Array => new TextEncoder().encode(JSON.stringify(raw, null, 2) + '\n')

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

export function imageDataUrl(path: string, bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${IMG_MIME[extensionOf(path)] ?? 'image/png'};base64,${btoa(binary)}`
}

// an axis range [min,max] becomes its midpoint: the editor edits one spot
function axis(v: Axis | undefined): number {
  if (Array.isArray(v)) return v.length === 0 ? 0 : (Math.min(...v) + Math.max(...v)) / 2
  return typeof v === 'number' ? v : 0
}

export function extractSettings(raw: RawSceneJson): Omit<SceneSettings, 'thumbnail'> {
  return {
    title: raw.display?.title ?? '',
    description: raw.display?.description ?? '',
    thumbnailPath: raw.display?.navmapThumbnail ?? null,
    contactName: raw.contact?.name ?? '',
    contactEmail: raw.contact?.email ?? '',
    parcels: Array.isArray(raw.scene?.parcels) ? [...raw.scene.parcels] : [],
    base: raw.scene?.base ?? '',
    spawnPoints: (raw.spawnPoints ?? []).map((p, i) => ({
      name: p.name ?? `Spawn Point ${i + 1}`,
      default: p.default === true,
      position: { x: axis(p.position?.x), y: axis(p.position?.y), z: axis(p.position?.z) },
      ...(p.cameraTarget !== undefined
        ? { cameraTarget: { x: axis(p.cameraTarget.x), y: axis(p.cameraTarget.y), z: axis(p.cameraTarget.z) } }
        : {})
    }))
  }
}

const PARCEL_RE = /^-?\d+,-?\d+$/

export function validateSettings(s: SceneSettings): string | null {
  if (s.title.trim() === '') return 'The scene needs a name'
  if (s.parcels.length === 0) return 'The scene needs at least one parcel'
  const bad = s.parcels.find((p) => !PARCEL_RE.test(p))
  if (bad !== undefined) return `"${bad}" is not a valid parcel — use "x,y"`
  if (new Set(s.parcels).size !== s.parcels.length) return 'Duplicate parcels'
  if (!s.parcels.includes(s.base)) return 'The base parcel must be one of the scene’s parcels'
  for (const sp of s.spawnPoints) {
    if (sp.name.trim() === '') return 'Every spawn point needs a name'
    for (const v of [sp.position.x, sp.position.y, sp.position.z]) {
      if (!Number.isFinite(v)) return `Spawn point "${sp.name}" has an invalid position`
    }
    if (sp.cameraTarget !== undefined) {
      for (const v of [sp.cameraTarget.x, sp.cameraTarget.y, sp.cameraTarget.z]) {
        if (!Number.isFinite(v)) return `Spawn point "${sp.name}" has an invalid camera target`
      }
    }
  }
  return null
}

// Keeps every field the editor does not model. `raw` is not mutated.
export function applySettings(raw: RawSceneJson, s: SceneSettings): RawSceneJson {
  const spawnPoints = s.spawnPoints.map((p: SpawnPointSetting) => ({
    name: p.name.trim(),
    default: p.default,
    position: { x: p.position.x, y: p.position.y, z: p.position.z },
    ...(p.cameraTarget !== undefined ? { cameraTarget: { ...p.cameraTarget } } : {})
  }))
  return {
    ...raw,
    display: {
      ...(raw.display ?? {}),
      title: s.title.trim(),
      description: s.description.trim(),
      ...(s.thumbnailPath !== null ? { navmapThumbnail: s.thumbnailPath } : {})
    },
    contact: { ...(raw.contact ?? {}), name: s.contactName.trim(), email: s.contactEmail.trim() },
    scene: { ...(raw.scene ?? {}), parcels: [...s.parcels], base: s.base },
    spawnPoints
  }
}

// Where Stop puts the player back, in world space ("x,y,z"): the authored spawn
// point, else the centre of the base parcel. Empty when there is no usable base.
export function spawnWorldPosition(raw: RawSceneJson): string {
  const [px, py] = (raw.scene?.base ?? '0,0').split(',').map((n) => parseInt(n, 10))
  if (!Number.isFinite(px) || !Number.isFinite(py)) return ''
  const point = raw.spawnPoints?.find((p) => p.default) ?? raw.spawnPoints?.[0]
  if (point?.position === undefined) return `${px * 16 + 8},0,${py * 16 + 8}`
  const { x, y, z } = point.position
  return `${px * 16 + axis(x)},${axis(y)},${py * 16 + axis(z)}`
}

export const COMPOSITE_CANDIDATES = ['assets/scene/main.composite', 'main.composite', 'assets/main.composite']

// The entities authored into a main.composite, from its text.
export function compositeEntityIds(text: string): number[] {
  let doc: { components?: Array<{ name?: string; data?: Record<string, unknown> }> }
  try {
    doc = JSON.parse(text)
  } catch {
    return []
  }
  const ids = new Set<number>()
  for (const c of doc.components ?? []) {
    // composite::root is the container itself, not scene content
    if (c?.name === 'composite::root') continue
    for (const key of Object.keys(c?.data ?? {})) {
      const n = Number(key)
      // entity 0 is the scene root and carries only editor metadata
      if (Number.isFinite(n) && n > 0) ids.add(n)
    }
  }
  return [...ids].sort((a, b) => a - b)
}
