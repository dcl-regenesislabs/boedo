export interface Point { x: number; y: number; z: number }
export interface Rotation { x: number; y: number; z: number; w: number }
export type MovementKey = 'W' | 'A' | 'S' | 'D'

export function movementKeys(from: Point, to: Point, camera: Rotation): MovementKey[] {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.hypot(dx, dz) < 0.35) return []
  const forwardX = 2 * (camera.x * camera.z + camera.w * camera.y)
  const forwardZ = 1 - 2 * (camera.x * camera.x + camera.y * camera.y)
  const length = Math.hypot(forwardX, forwardZ)
  const x = length > 0.001 ? forwardX / length : 0
  const z = length > 0.001 ? forwardZ / length : 1
  const forward = dx * x + dz * z
  const right = dx * z - dz * x
  const keys: MovementKey[] = []
  if (Math.abs(forward) >= Math.abs(right) * Math.tan(Math.PI / 8)) keys.push(forward >= 0 ? 'W' : 'S')
  if (Math.abs(right) >= Math.abs(forward) * Math.tan(Math.PI / 8)) keys.push(right >= 0 ? 'D' : 'A')
  return keys
}

export function playerPosition(value: string): Point | null {
  const match = /\(\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+)\s*\)/i.exec(value)
  if (match === null) return null
  const [x, y, z] = match.slice(1).map(Number)
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null
}

export async function steerJump(to: Point, camera: Rotation, controls: {
  position: () => Promise<Point | null>
  keys: (keys: string[]) => void | Promise<void>
}, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 5000
  let started: number | undefined
  let previous: Point | null = null
  let previousTime = 0
  const release = () => { void controls.keys([]) }
  signal.addEventListener('abort', release, { once: true })
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      const position = await controls.position()
      signal.throwIfAborted()
      if (position === null) throw new Error('The player position is unavailable.')
      const now = Date.now()
      started ??= now
      const elapsed = now - started
      // Brake before the target: the avatar carries momentum after key release.
      const lead = previous && now > previousTime ? Math.min(2, 100 / (now - previousTime)) : 0
      const steering = previous ? {
        x: position.x + (position.x - previous.x) * lead,
        y: position.y,
        z: position.z + (position.z - previous.z) * lead
      } : position
      const keys = movementKeys(steering, to, camera)
      const settled = previous !== null && Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) < 0.08
      if (elapsed > 600 && settled && Math.hypot(position.x - to.x, position.z - to.z) < 0.35 && Math.abs(position.y - to.y) < 0.5) return
      previous = position
      previousTime = now
      await controls.keys(elapsed < 150 ? [...keys, 'Space'] : keys)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('The jump did not reach its landing. Check the player position and choose a closer platform.')
  } finally {
    await controls.keys([])
    signal.removeEventListener('abort', release)
  }
}
