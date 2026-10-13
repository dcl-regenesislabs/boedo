// What the build worker does to a script's model before export; pure, so it is tested without a worker.
import * as THREE from 'three'

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
