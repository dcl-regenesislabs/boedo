// The in-memory file system a build runs over.

export type FileContent = string | Uint8Array

export const PROJECT_ROOT = '/scene'

export function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '' && part !== '.') out.push(part)
  }
  return '/' + out.join('/')
}

export const join = (dir: string, rel: string): string => normalize(dir + '/' + rel)

export function dirname(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

export function extname(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot)
}

const decoder = new TextDecoder()

export class Vfs {
  private readonly files = new Map<string, FileContent>()
  private readonly dirs = new Set<string>()
  private readonly parsed = new Map<string, unknown>()

  set(path: string, content: FileContent): void {
    this.files.set(path, content)
    this.parsed.delete(path)
    for (let dir = dirname(path); !this.dirs.has(dir); dir = dirname(dir)) {
      this.dirs.add(dir)
      if (dir === '/') break
    }
  }

  has(path: string): boolean {
    return this.files.has(path)
  }

  isDir(path: string): boolean {
    return this.dirs.has(path)
  }

  read(path: string): FileContent | undefined {
    return this.files.get(path)
  }

  text(path: string): string | undefined {
    const content = this.files.get(path)
    return content === undefined || typeof content === 'string' ? content : decoder.decode(content)
  }

  // undefined when the file is missing or malformed
  json(path: string): unknown {
    if (this.parsed.has(path)) return this.parsed.get(path)
    let value: unknown
    const text = this.text(path)
    if (text !== undefined) {
      try {
        value = JSON.parse(text)
      } catch {
        value = undefined
      }
    }
    this.parsed.set(path, value)
    return value
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
