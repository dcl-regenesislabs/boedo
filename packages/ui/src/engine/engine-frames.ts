// The engine calls window.__engineHeartbeat() once per rendered frame (the explorer's boot.js), so
// counting those calls is its real frame rate; the editor page's own animation frames are not.
import { getEngineWindow } from './console'

type Beat = ((...args: unknown[]) => unknown) & { counted?: true }
type HeartbeatWindow = Window & { __engineHeartbeat?: Beat }

const SAMPLES = 240
const WINDOW_MS = 2000
const stamps: number[] = []

// rehooked whenever the engine installs a fresh heartbeat; times come from the engine window's clock
let hooked: Window | null = null

function hook(w: HeartbeatWindow): boolean {
  // a new engine window has its own clock: the old stamps would read as frames from the future
  if (w !== hooked) {
    stamps.length = 0
    hooked = w
  }
  const beat = w.__engineHeartbeat
  if (typeof beat !== 'function') return false
  if (beat.counted === true) return true
  const counted: Beat = function (this: unknown, ...args: unknown[]) {
    stamps.push(w.performance.now())
    if (stamps.length > SAMPLES) stamps.shift()
    return beat.apply(this, args)
  }
  counted.counted = true
  w.__engineHeartbeat = counted
  return true
}

export interface EngineFrames {
  fps: number
  frameMs: number | null
  p95Ms: number | null
}

// null when this engine has no heartbeat to count
export function engineFrames(): EngineFrames | null {
  const w = getEngineWindow() as HeartbeatWindow
  if (!hook(w)) return null
  const now = w.performance.now()
  const recent = stamps.filter((t) => now - t <= WINDOW_MS)
  if (recent.length < 2) return { fps: 0, frameMs: null, p95Ms: null }
  const gaps = recent.slice(1).map((t, i) => t - recent[i]).sort((a, b) => a - b)
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length
  return {
    fps: Math.round(((recent.length - 1) * 1000) / (recent[recent.length - 1] - recent[0])),
    frameMs: Math.round(mean * 10) / 10,
    p95Ms: Math.round(gaps[Math.round((gaps.length - 1) * 0.95)] * 10) / 10
  }
}
