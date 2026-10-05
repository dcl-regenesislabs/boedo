export interface FakeWorldsOptions {
  // a world with no owner goes to the first wallet that deploys to it
  worlds?: Record<string, { owner?: string; deployers?: string[] }>
  now?: () => number
  ttlMs?: number
  maxBytes?: number
  maxParcels?: number
}

export interface FakeWorlds {
  // "<method> <path> <status>" of every request
  log: string[]
  content: Map<string, Uint8Array>
  entities(name: string): Array<{ id: string; pointers: string[]; content: { file: string; hash: string }[]; metadata: Record<string, unknown> }>
  handle(request: Request, origin?: string): Promise<Response>
}

export function createFakeWorlds(options?: FakeWorldsOptions): FakeWorlds
