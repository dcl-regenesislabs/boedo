import { state } from '@scene/state'
import { subscribe } from '@scene/reactive'

export function waitForPreviewLayout(parcels: string[], launch: () => void, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const previous = state.scene
  const expected = [...parcels].sort().join(';')
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', abort) }
    const fail = (error: unknown) => { cleanup(); reject(error) }
    const check = () => {
      if (state.scene === previous || state.status !== 'ready' || !state.frozen) return
      const actual = state.scene?.parcels.map(p => `${p.x},${p.y}`).sort().join(';')
      if (actual !== expected) return
      cleanup()
      resolve()
    }
    const unsubscribe = subscribe(check)
    const abort = () => fail(signal.reason)
    const timer = setTimeout(() => fail(new Error('The preview has not loaded the new parcels. Retry sceneSettings before building outside the current layout.')), 90_000)
    signal.addEventListener('abort', abort, { once: true })
    try { launch(); check() } catch (error) { fail(error) }
  })
}
