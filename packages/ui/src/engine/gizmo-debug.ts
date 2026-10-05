// `__euiGizmoDebug()` in the devtools console when the gizmo draws wrong: the scene's
// recent gizmo frames plus what the engine's gizmo camera rendered and where the player is.
import { sceneRpc } from './bus'
import { consoleCommand } from './console'

// GIZMO_LAYER in packages/scene/src/viewport/gizmo.ts
const GIZMO_LAYER = '4'

const settle = <T>(p: Promise<T>): Promise<T | string> => p.catch((e: unknown) => `failed: ${String(e)}`)

export async function captureGizmoDebug(): Promise<unknown> {
  const [scene, player, gizmoView] = await Promise.all([
    settle(sceneRpc<unknown>('gizmoDebug')),
    settle(consoleCommand('/player_position')),
    settle(consoleCommand('/texture_camera_screenshot', [GIZMO_LAYER, '1024']))
  ])
  const report = { at: new Date().toISOString(), screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, player, scene }
  console.log('[gizmo-debug]', JSON.stringify(report))
  if (typeof gizmoView === 'string' && !gizmoView.startsWith('failed')) console.log('[gizmo-debug] gizmo camera view:', `data:image/png;base64,${gizmoView}`)
  else console.log('[gizmo-debug] gizmo camera view unavailable:', gizmoView)
  return { ...report, gizmoView }
}

;(window as unknown as Record<string, unknown>).__euiGizmoDebug = captureGizmoDebug
