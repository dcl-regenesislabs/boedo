// What the build worker does to a script's model before export; pure, so it is tested without a worker.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { pascal } from './materials'

const MAX_CANVAS = 512
const powerOfTwo = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_CANVAS && (n & (n - 1)) === 0

// never rounded up: the drawing would fill one corner and stop matching the UVs
export function checkCanvasSize(width: number, height: number): void {
  if (powerOfTwo(width) && powerOfTwo(height)) return
  throw new Error(`addons.canvas(${String(width)}, ${String(height)}): each side must be a power of two up to ${MAX_CANVAS} ` +
    '(1, 2, 4, 8, 16, 32, 64, 128, 256 or 512); pick those sizes and draw to fit them.')
}

// Decentraland's client ignores vertex colours, so a model coloured that way would look different there
export function stripVertexColors(root: THREE.Object3D): string[] {
  let parts = 0
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const geometry: THREE.BufferGeometry = node.geometry
    const colored = geometry.getAttribute('color') !== undefined || (node instanceof THREE.InstancedMesh && node.instanceColor !== null)
    if (!colored) return
    geometry.deleteAttribute('color')
    if (node instanceof THREE.InstancedMesh) node.instanceColor = null
    parts++
  })
  return parts === 0 ? [] : [`Removed vertex colours from ${parts} part${parts === 1 ? '' : 's'}: Decentraland ignores them. Colour parts with materials instead.`]
}

// the same surface facing the other way: reversed winding, and normals turned unless a transform already did
export function flipped(geometry: THREE.BufferGeometry, turnNormals = true): THREE.BufferGeometry {
  const out = geometry.clone()
  if (out.index === null) out.setIndex([...Array(out.getAttribute('position').count).keys()])
  const index = out.index
  if (index === null) return out
  for (let i = 0; i + 2 < index.count; i += 3) {
    const b = index.getX(i + 1)
    index.setX(i + 1, index.getX(i + 2))
    index.setX(i + 2, b)
  }
  const normal = out.getAttribute('normal')
  if (turnNormals && normal !== undefined) {
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i))
  }
  return out
}

const sides = (mesh: THREE.Mesh): THREE.Side[] => [mesh.material].flat().map((material) => material.side)

// Decentraland culls back faces, so a double-sided part gets a back copy and a back-sided one turns around
export function singleSided(root: THREE.Object3D): void {
  const doubled: THREE.Mesh[] = []
  const reversed: THREE.Mesh[] = []
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node instanceof THREE.SkinnedMesh || /_collider/i.test(node.name)) return
    if (sides(node).every((side) => side === THREE.DoubleSide)) doubled.push(node)
    else if (sides(node).every((side) => side === THREE.BackSide)) reversed.push(node)
  })
  const turned = new Map<string, THREE.BufferGeometry>()
  const turn = (geometry: THREE.BufferGeometry): THREE.BufferGeometry => {
    let out = turned.get(geometry.uuid)
    if (out === undefined) turned.set(geometry.uuid, out = flipped(geometry))
    return out
  }
  for (const mesh of doubled) {
    // a child at its origin, so it follows the part and anything animating it
    const back = mesh.clone(false)
    back.name = ''
    back.position.set(0, 0, 0)
    back.quaternion.identity()
    back.scale.set(1, 1, 1)
    back.geometry = turn(mesh.geometry)
    mesh.add(back)
  }
  for (const mesh of reversed) mesh.geometry = turn(mesh.geometry)
  // front and back share the material, now one-sided, so it still counts once
  for (const mesh of [...doubled, ...reversed]) for (const material of [mesh.material].flat()) material.side = THREE.FrontSide
  root.updateMatrixWorld(true)
}

// Decentraland names parts <Model>_Part01…; pascal() leaves no '_', so no name can read as a collider
export function partNamer(model: string): { name: (node: THREE.Object3D) => string; nameAll: (root: THREE.Object3D) => void } {
  const prefix = pascal(model).slice(0, 40) || 'Model'
  const taken = new Set<string>()
  let count = 0
  const next = (): string => {
    let name: string
    do name = `${prefix}_Part${String(++count).padStart(2, '0')}`
    while (taken.has(name))
    taken.add(name)
    return name
  }
  return {
    name: (node) => {
      if (node.name === '') node.name = next()
      return node.name
    },
    // never renames a part the script named
    nameAll: (root) => {
      root.traverse((node) => { if (node.name !== '') taken.add(node.name) })
      root.traverse((node) => { if (node !== root && node.name === '') node.name = next() })
    }
  }
}

const shown = (node: THREE.Object3D, root: THREE.Object3D): boolean => {
  for (let at: THREE.Object3D | null = node; at !== null && at !== root; at = at.parent) if (!at.visible) return false
  return root.visible
}

// what a merge must leave alone: everything a clip moves, with whatever is above or below it
function animatedNodes(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): Set<THREE.Object3D> {
  const targets = new Set(clips.flatMap((clip) => clip.tracks.map((track) => THREE.PropertyBinding.parseTrackName(track.name).nodeName)))
  const held = new Set<THREE.Object3D>()
  root.traverse((node) => {
    if (!targets.has(node.name) && !targets.has(node.uuid)) return
    node.traverse((below) => held.add(below))
    node.traverseAncestors((above) => held.add(above))
  })
  return held
}

// Each part is a draw call per material, so many static unnamed parts sharing one become one mesh.
// Merging copies shared geometry, so small groups stay apart: the file would only grow.
export function mergeStatic(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], least = 5): void {
  root.updateMatrixWorld(true)
  const held = animatedNodes(root, clips)
  const groups = new Map<string, THREE.Mesh[]>()
  root.traverse((node) => {
    // named parts are the script's
    if (!(node instanceof THREE.Mesh) || node instanceof THREE.InstancedMesh || node instanceof THREE.SkinnedMesh) return
    if (node.name !== '' || held.has(node) || !shown(node, root)) return
    const geometry: THREE.BufferGeometry = node.geometry
    if (Array.isArray(node.material) || Object.keys(geometry.morphAttributes).length > 0) return
    const material: THREE.Material = node.material
    const attributes = Object.entries(geometry.attributes)
      .map(([name, a]) => `${name}:${a.itemSize}:${String(a.normalized)}:${a.array.constructor.name}`).sort().join(',')
    const key = `${material.uuid}|${String(geometry.index !== null)}|${attributes}`
    groups.set(key, [...(groups.get(key) ?? []), node])
  })
  const toRoot = root.matrixWorld.clone().invert()
  for (const meshes of groups.values()) {
    if (meshes.length < least) continue
    const baked = meshes.map((mesh) => {
      const matrix = toRoot.clone().multiply(mesh.matrixWorld)
      const geometry = mesh.geometry.clone().applyMatrix4(matrix)
      // a mirroring transform turned the faces inside out once baked in
      return matrix.determinant() < 0 ? flipped(geometry, false) : geometry
    })
    const merged = mergeGeometries(baked)
    if (merged === null) continue
    for (const mesh of meshes) {
      let emptied: THREE.Object3D | null = mesh.parent
      // what hangs below a merged part (a back copy, another material) stays where it is in the world
      for (const child of [...mesh.children]) emptied?.attach(child)
      mesh.removeFromParent()
      // groups the merge emptied would export as stray nodes
      const group = (node: THREE.Object3D): boolean => node instanceof THREE.Group || node.constructor === THREE.Object3D
      while (emptied !== null && emptied !== root && group(emptied) && emptied.children.length === 0 && emptied.name === '' && !held.has(emptied)) {
        const above: THREE.Object3D | null = emptied.parent
        emptied.removeFromParent()
        emptied = above
      }
    }
    root.add(new THREE.Mesh(merged, meshes[0].material))
  }
  root.updateMatrixWorld(true)
}
