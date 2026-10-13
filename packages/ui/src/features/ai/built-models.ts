// Models the assistant built this session, announced as they land so the chat can show each one.
export interface BuiltModel {
  name: string
  path: string
  triangles: number
}

const listeners = new Set<(model: BuiltModel) => void>()

export function announceBuiltModel(model: BuiltModel): void {
  for (const listener of listeners) listener(model)
}

export function onBuiltModel(listener: (model: BuiltModel) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
