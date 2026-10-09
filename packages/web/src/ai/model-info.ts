import { object } from '@dcl-editor/contract'
import { Matrix, Quaternion, Vector3 } from '@dcl/sdk/math'

const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.map((item) => { if (!object(item)) throw new Error('Invalid glTF object.'); return item }) : []

function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('Invalid glTF transform or bounds.')
  }
  return value as number[]
}

function vector(value: unknown, fallback: number[]): Vector3.MutableVector3 {
  const [x, y, z] = numbers(value ?? fallback, 3)
  return { x, y, z }
}

function at<T>(items: T[], index: unknown): T {
  if (typeof index !== 'number' || !Number.isInteger(index) || items[index] === undefined) throw new Error('Invalid glTF index.')
  return items[index]
}

function document(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Models must fit the 50 MB file limit.')
  let json = bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x46546c67) {
    if (bytes.length < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length ||
        view.getUint32(16, true) !== 0x4e4f534a || view.getUint32(12, true) > bytes.length - 20) throw new Error('Invalid GLB header.')
    json = bytes.subarray(20, 20 + view.getUint32(12, true))
  }
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
  if (!object(parsed) || !object(parsed.asset) || parsed.asset.version !== '2.0') throw new Error('A glTF 2.0 model is required.')
  return parsed
}

export function inspectModel(bytes: Uint8Array) {
  const gltf = document(bytes)
  const nodes = rows(gltf.nodes), meshes = rows(gltf.meshes), accessors = rows(gltf.accessors)
  const scenes = rows(gltf.scenes)
  const warnings = new Set<string>()
  const colliderNodes: string[] = []
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  let complete = true, primitives = 0, triangles = 0
  const visited = new Set<number>()
  const walk = (index: unknown, parent: Matrix.ReadonlyMatrix, depth: number): void => {
    const node = at(nodes, index)
    if (depth > 128 || visited.has(index as number)) throw new Error('Invalid glTF node hierarchy.')
    visited.add(index as number)
    let local: Matrix.MutableMatrix
    if (node.matrix !== undefined) local = Matrix.fromArray(numbers(node.matrix, 16) as Matrix.Matrix4x4)
    else {
      const [x, y, z, w] = numbers(node.rotation ?? [0, 0, 0, 1], 4)
      local = Matrix.compose(vector(node.scale, [1, 1, 1]), Quaternion.create(x, y, z, w), vector(node.translation, [0, 0, 0]))
    }
    const world = Matrix.multiply(local, parent)
    const name = typeof node.name === 'string' ? node.name : `node ${String(index)}`
    const collider = name.toLowerCase().includes('_collider')
    if (collider) colliderNodes.push(name)
    if (node.skin !== undefined) warnings.add('Bounds describe the rest pose; skinning and animation can extend them.')
    if (object(node.extensions) && node.extensions.EXT_mesh_gpu_instancing !== undefined) {
      complete = false
      warnings.add('Instanced node bounds are unavailable; check the rendered model.')
    }
    if (node.mesh !== undefined && !collider) {
      for (const primitive of rows(at(meshes, node.mesh).primitives)) {
        primitives++
        if (Array.isArray(primitive.targets) && primitive.targets.length > 0) warnings.add('Morph target bounds are not included.')
        const position = object(primitive.attributes) ? at(accessors, primitive.attributes.POSITION) : null
        if (position === null || position.min === undefined || position.max === undefined) {
          complete = false
          warnings.add('Some primitives have no declared position bounds.')
          continue
        }
        const lo = numbers(position.min, 3), hi = numbers(position.max, 3)
        if (lo.some((n, axis) => n > hi[axis])) throw new Error('Invalid glTF bounds.')
        for (let corner = 0; corner < 8; corner++) {
          const p = Vector3.transformCoordinates({ x: (corner & 1 ? hi : lo)[0], y: (corner & 2 ? hi : lo)[1], z: (corner & 4 ? hi : lo)[2] }, world)
          // Bevy rotates GLB roots 180° about Y, then SDK coordinates mirror Z.
          p.x = -p.x
          for (const axis of ['x', 'y', 'z'] as const) {
            if (!Number.isFinite(p[axis])) throw new Error('Invalid transformed model bounds.')
            min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis])
          }
        }
        const count = primitive.indices === undefined ? position.count : at(accessors, primitive.indices).count
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
          if (primitive.mode === undefined || primitive.mode === 4) triangles += Math.floor(count / 3)
          else if (primitive.mode === 5 || primitive.mode === 6) triangles += Math.max(0, count - 2)
        }
      }
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error('Invalid glTF children.')
      for (const child of node.children) walk(child, world, depth + 1)
    }
  }
  if (scenes.length === 0) throw new Error('The model has no glTF scene.')
  const roots = at(scenes, gltf.scene ?? 0).nodes
  if (!Array.isArray(roots)) throw new Error('The model has no scene roots.')
  for (const root of roots) walk(root, Matrix.Identity(), 0)
  const bounds = complete && Number.isFinite(min.x) ? { min, max, size: Vector3.subtract(max, min) } : null
  const resources = [...rows(gltf.images), ...rows(gltf.buffers)]
    .flatMap((item) => typeof item.uri === 'string' && !item.uri.startsWith('data:') ? [item.uri] : [])
  const animations = rows(gltf.animations).map((a, i) => typeof a.name === 'string' ? a.name : `animation ${i}`)
  if (animations.length > 0) warnings.add('Static bounds exclude movement during animation.')
  return {
    bytes: bytes.byteLength, bounds, coordinates: 'SDK local metres, before entity Transform; conservative static visual bounds',
    triangles, primitives, materials: rows(gltf.materials).map((m, i) => typeof m.name === 'string' ? m.name : `material ${i}`),
    animations, colliderNodes, externalResources: resources, warnings: [...warnings]
  }
}
