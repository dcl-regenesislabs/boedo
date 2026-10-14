// Thumbnails the assistant painted or switched to, announced so the chat can show each version.
export interface BuiltThumbnail {
  path: string
  version: number
}

const listeners = new Set<(thumbnail: BuiltThumbnail) => void>()
const usedListeners = new Set<(path: string) => void>()

export function announceThumbnail(thumbnail: BuiltThumbnail): void {
  for (const listener of listeners) listener(thumbnail)
  announceThumbnailUsed(thumbnail.path)
}

export function onThumbnail(listener: (thumbnail: BuiltThumbnail) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function announceThumbnailUsed(path: string): void {
  for (const listener of usedListeners) listener(path)
}

export function onThumbnailUsed(listener: (path: string) => void): () => void {
  usedListeners.add(listener)
  return () => usedListeners.delete(listener)
}
