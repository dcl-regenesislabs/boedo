// What a model script may not reach: the network and the origin's storage. The exporter
// needs only Blob, FileReader and OffscreenCanvas, which stay.
const BLOCKED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'Worker', 'SharedWorker',
  'BroadcastChannel', 'FontFace', 'fonts', 'indexedDB', 'caches', 'navigator', 'Request', 'Response'
]

// Removed from the scope and every prototype above it: a global deleted from the scope
// alone is still reachable through Object.getPrototypeOf(self).
export function lockDown(scope: object): void {
  for (let level: object | null = scope; level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const name of BLOCKED) {
      if (Object.prototype.hasOwnProperty.call(level, name)) delete (level as Record<string, unknown>)[name]
    }
  }
  for (const name of BLOCKED) {
    if (name in scope) Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false })
  }
}

// best effort only (eval can assemble it): the frame's policy is what blocks import()
export function refusedSyntax(code: string): string | null {
  return /\bimport\s*\(/.test(code) ? 'import() is not allowed in a model script.' : null
}
