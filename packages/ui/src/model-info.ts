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

// The GLB's binary chunk, where embedded images live; empty for a .gltf file.
function binChunk(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) return new Uint8Array(0)
  const at = 20 + view.getUint32(12, true)
  if (at + 8 > bytes.length) return new Uint8Array(0)
  return bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + view.getUint32(at, true)))
}

// The sizes of the images embedded in the file that can be read.
function embeddedImageSizes(gltf: Record<string, unknown>, bin: Uint8Array): { width: number; height: number }[] {
  const views = rows(gltf.bufferViews)
  const sizes: { width: number; height: number }[] = []
  for (const image of rows(gltf.images)) {
    if (typeof image.bufferView !== 'number') continue
    const view = views[image.bufferView]
    if (view === undefined || typeof view.byteLength !== 'number') continue
    const start = typeof view.byteOffset === 'number' ? view.byteOffset : 0
    const size = imageSize(bin.subarray(start, start + view.byteLength))
    if (size !== null) sizes.push(size)
  }
  return sizes
}

const MAX_TEXTURE_SIDE = 1024
const powerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0

// Width and height from a PNG or JPEG header, without decoding it.
export function imageSize(image: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  if (image.length >= 24 && view.getUint32(0) === 0x89504e47) return { width: view.getUint32(16), height: view.getUint32(20) }
  if (image.length < 4 || view.getUint16(0) !== 0xffd8) return null
  for (let at = 2; at + 9 < image.length;) {
    if (image[at] !== 0xff) return null
    const marker = image[at + 1]
    const length = view.getUint16(at + 2)
    // a start-of-frame segment carries the size; the others are skipped by their length
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) }
    at += 2 + length
  }
  return null
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
  // each mesh read once: a file where many nodes share a mesh of many primitives must not cost their product
  const summaries = new Map<unknown, { primitives: number; triangles: number; box: { lo: number[]; hi: number[] } | null; unbounded: boolean }>()
  const meshSummary = (index: unknown) => {
    const cached = summaries.get(index)
    if (cached !== undefined) return cached
    let count = 0, tris = 0, unbounded = false
    let lo: number[] | null = null, hi: number[] | null = null
    for (const primitive of rows(at(meshes, index).primitives)) {
      count++
      if (Array.isArray(primitive.targets) && primitive.targets.length > 0) warnings.add('Morph target bounds are not included.')
      const position = object(primitive.attributes) ? at(accessors, primitive.attributes.POSITION) : null
      if (position === null || position.min === undefined || position.max === undefined) {
        unbounded = true
        continue
      }
      const pLo = numbers(position.min, 3), pHi = numbers(position.max, 3)
      if (pLo.some((n, axis) => n > pHi[axis])) throw new Error('Invalid glTF bounds.')
      lo = lo === null ? pLo : lo.map((n, axis) => Math.min(n, pLo[axis]))
      hi = hi === null ? pHi : hi.map((n, axis) => Math.max(n, pHi[axis]))
      const n = primitive.indices === undefined ? position.count : at(accessors, primitive.indices).count
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) {
        if (primitive.mode === undefined || primitive.mode === 4) tris += Math.floor(n / 3)
        else if (primitive.mode === 5 || primitive.mode === 6) tris += Math.max(0, n - 2)
      }
    }
    const summary = { primitives: count, triangles: tris, box: lo === null || hi === null ? null : { lo, hi }, unbounded }
    summaries.set(index, summary)
    return summary
  }
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
    if (node.mesh !== undefined) {
      // a collider costs the scene's triangles and bodies too, but draws nothing
      const summary = meshSummary(node.mesh)
      primitives += summary.primitives
      triangles += summary.triangles
      if (summary.unbounded && !collider) {
        complete = false
        warnings.add('Some primitives have no declared position bounds.')
      }
      if (summary.box !== null && !collider) {
        const { lo, hi } = summary.box
        for (let corner = 0; corner < 8; corner++) {
          const p = Vector3.transformCoordinates({ x: (corner & 1 ? hi : lo)[0], y: (corner & 2 ? hi : lo)[1], z: (corner & 4 ? hi : lo)[2] }, world)
          // Bevy rotates GLB roots 180° about Y, then SDK coordinates mirror Z.
          p.x = -p.x
          for (const axis of ['x', 'y', 'z'] as const) {
            if (!Number.isFinite(p[axis])) throw new Error('Invalid transformed model bounds.')
            min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis])
          }
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
  // a caveat about the bounds, not a problem with the model: it must not reach the creator as a warning
  const images = embeddedImageSizes(gltf, binChunk(bytes))
  // DCL's converter wants power-of-two sides and scales anything past 1024 down
  const textureProblems = images.flatMap(({ width, height }) =>
    !powerOfTwo(width) || !powerOfTwo(height) ? [`${width}x${height} is not a power of two`]
      : Math.max(width, height) > MAX_TEXTURE_SIDE ? [`${width}x${height} is over ${MAX_TEXTURE_SIDE}`] : [])
  for (const problem of textureProblems) warnings.add(`Texture ${problem}.`)
  const coordinates = `SDK local metres, before entity Transform; conservative static visual bounds${animations.length > 0 ? ' that leave out movement during animation' : ''}`
  return {
    bytes: bytes.byteLength, bounds, coordinates,
    triangles, primitives, materials: rows(gltf.materials).map((m, i) => typeof m.name === 'string' ? m.name : `material ${i}`),
    textures: rows(gltf.images).length,
    largestImage: images.reduce((largest, size) => Math.max(largest, size.width, size.height), 0),
    textureProblems,
    sharedImages: rows(gltf.images).flatMap((image) => typeof image.uri === 'string' && !image.uri.startsWith('data:') ? [image.uri] : []),
    animations, colliderNodes, externalResources: resources, warnings: [...warnings]
  }
}
