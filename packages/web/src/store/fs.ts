// The slice of the Origin Private File System and of Web Locks the project
// store uses. The browser's own objects satisfy these as they are.

export interface FileEntry {
  kind: 'file'
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>
  createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void> }>
}

export interface DirEntry {
  kind: 'directory'
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirEntry>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileEntry>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>
}

export interface Locks {
  // the callback gets null when `ifAvailable` is set and the lock is taken
  request<T>(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T>): Promise<T>
}

export interface StoreBackend {
  root: () => Promise<DirEntry>
  locks: Locks
}

export function browserBackend(): StoreBackend {
  return {
    root: () => navigator.storage.getDirectory(),
    locks: {
      // the DOM types miss that a promise returned by the callback is flattened
      request: <T>(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T>) =>
        navigator.locks.request(name, options, callback) as Promise<T>
    }
  }
}

// A missing file or folder, as the file system reports it.
export function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotFoundError'
}
