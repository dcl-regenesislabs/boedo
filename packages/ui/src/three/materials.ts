// The shared material library: tiling textures drawn in code, the same every time, so every model
// that uses one points at the same file instead of carrying its own copy.
export const LIBRARY = ['stone', 'brick', 'planks', 'wood', 'roof', 'metal', 'grass', 'sand'] as const
export type LibraryName = (typeof LIBRARY)[number]

const SIZE = 512

function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shade = (h: number, s: number, l: number): string => `hsl(${h},${s}%,${l}%)`

function speckle(g: OffscreenCanvasRenderingContext2D, rnd: () => number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`
    g.fillRect(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 3, 1 + rnd() * 3)
  }
}

// a row of blocks whose widths add up to the tile, so rows wrap without a seam
function row(rnd: () => number, min: number, max: number): number[] {
  const widths: number[] = []
  let total = 0
  while (total < SIZE) {
    const w = min + rnd() * (max - min)
    widths.push(w)
    total += w
  }
  return widths.map((w) => (w * SIZE) / total)
}

function courses(g: OffscreenCanvasRenderingContext2D, rnd: () => number, height: number, min: number, max: number, color: () => string, mortar: string, gap: number): void {
  g.fillStyle = mortar
  g.fillRect(0, 0, SIZE, SIZE)
  for (let y = 0; y < SIZE; y += height) {
    let x = rnd() * max
    for (const w of row(rnd, min, max)) {
      g.fillStyle = color()
      g.fillRect((x % SIZE) + gap, y + gap, w - gap * 2, height - gap * 2)
      if (x % SIZE + w > SIZE) g.fillRect((x % SIZE) - SIZE + gap, y + gap, w - gap * 2, height - gap * 2)
      x += w
    }
  }
}

function grain(g: OffscreenCanvasRenderingContext2D, rnd: () => number, x0: number, width: number, hue: number, light: number): void {
  for (let x = x0; x < x0 + width; x += 2) {
    const l = light + Math.sin(x * 0.21 + rnd() * 0.6) * 4 + (rnd() - 0.5) * 3
    g.fillStyle = shade(hue, 45, l)
    g.fillRect(x, 0, 2, SIZE)
  }
}

const DRAW: Record<LibraryName, (g: OffscreenCanvasRenderingContext2D, rnd: () => number) => void> = {
  stone: (g, rnd) => {
    courses(g, rnd, 64, 70, 150, () => shade(30, 6, 56 + rnd() * 18), '#4a4641', 3)
    speckle(g, rnd, 9000, 0.08)
  },
  brick: (g, rnd) => {
    courses(g, rnd, 32, 64, 64, () => shade(10 + rnd() * 8, 45, 32 + rnd() * 10), '#b8ab98', 2)
    speckle(g, rnd, 7000, 0.07)
  },
  planks: (g, rnd) => {
    for (let x = 0; x < SIZE; x += 64) {
      grain(g, rnd, x, 64, 28 + rnd() * 6, 34 + rnd() * 10)
      g.fillStyle = 'rgba(20,10,5,0.75)'
      g.fillRect(x, 0, 2, SIZE)
    }
    speckle(g, rnd, 3000, 0.05)
  },
  wood: (g, rnd) => {
    grain(g, rnd, 0, SIZE, 30, 36)
    speckle(g, rnd, 3000, 0.05)
  },
  roof: (g, rnd) => {
    courses(g, rnd, 48, 40, 70, () => shade(8 + rnd() * 10, 30, 26 + rnd() * 10), '#1e1514', 2)
    for (let y = 0; y < SIZE; y += 48) {
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(0, y + 36, SIZE, 10)
    }
  },
  metal: (g, rnd) => {
    g.fillStyle = '#7d8288'
    g.fillRect(0, 0, SIZE, SIZE)
    for (let y = 0; y < SIZE; y += 2) {
      g.fillStyle = `rgba(255,255,255,${rnd() * 0.06})`
      g.fillRect(0, y, SIZE, 1)
    }
    g.fillStyle = 'rgba(0,0,0,0.45)'
    g.fillRect(0, 0, SIZE, 3)
    g.fillRect(0, 0, 3, SIZE)
    g.fillRect(0, SIZE / 2, SIZE, 3)
    for (const x of [16, SIZE / 2 - 16, SIZE / 2 + 16, SIZE - 16]) {
      for (const y of [16, SIZE / 2 - 16, SIZE / 2 + 16, SIZE - 16]) {
        g.fillStyle = '#5c6066'
        g.beginPath()
        g.arc(x, y, 5, 0, Math.PI * 2)
        g.fill()
      }
    }
  },
  grass: (g, rnd) => {
    g.fillStyle = '#4c7a2c'
    g.fillRect(0, 0, SIZE, SIZE)
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = shade(85 + rnd() * 25, 50, 24 + rnd() * 22)
      g.fillRect(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 2, 3 + rnd() * 6)
    }
  },
  sand: (g, rnd) => {
    g.fillStyle = '#cdb88e'
    g.fillRect(0, 0, SIZE, SIZE)
    speckle(g, rnd, 20000, 0.09)
  }
}

export function drawLibrary(name: LibraryName): OffscreenCanvas {
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const g = canvas.getContext('2d')
  if (g === null) throw new Error('no 2D canvas in this worker')
  DRAW[name](g, random(LIBRARY.indexOf(name) + 1))
  return canvas
}

export function isLibraryName(name: unknown): name is LibraryName {
  return typeof name === 'string' && (LIBRARY as readonly string[]).includes(name)
}
