// What the gizmo saw lately, for `__euiGizmoDebug()` on the page: the glitch this
// chases is intermittent, so a dump taken after it shows up needs the frames before.
import { engine, Transform, TextureCamera, UiCanvasInformation, type Entity } from '@dcl/sdk/ecs'
import { type Vector3 } from '@dcl/sdk/math'
import { state } from '../state'
import { cameraFovY, pointerCanvasPx, projectWorldToScreen } from '../camera/camera-projection'
import { worldTransformOf } from '../world-pos'

const SAMPLE_EVERY_S = 0.1
const KEEP = 50

type Sample = { t: number; cam: unknown; base: Vector3; dist: number; s: number; pos: Vector3; fov: number | null; camMode: string }

const samples: Sample[] = []
let clock = 0
let sinceLast = SAMPLE_EVERY_S

export function recordGizmoSample(dt: number, sample: Omit<Sample, 't' | 'fov' | 'camMode'>): void {
  clock += dt
  sinceLast += dt
  if (sinceLast < SAMPLE_EVERY_S) return
  sinceLast = 0
  samples.push({ t: clock, ...sample, fov: cameraFovY(), camMode: state.camMode })
  if (samples.length > KEEP) samples.shift()
}

export function gizmoDebugSnapshot(gizmoCamera: Entity | null, gizmoRoot: Entity | null): unknown {
  const active = state.activeEntity
  const anchor = active === null ? null : (worldTransformOf(state.snapshot, active)?.position ?? null)
  const report = {
    t: clock,
    camera: Transform.getOrNull(engine.CameraEntity),
    player: Transform.getOrNull(engine.PlayerEntity),
    gizmoCamera: gizmoCamera === null ? null : Transform.getOrNull(gizmoCamera),
    textureCamera: gizmoCamera === null ? null : TextureCamera.getOrNull(gizmoCamera),
    gizmoRoot: gizmoRoot === null ? null : Transform.getOrNull(gizmoRoot),
    canvas: UiCanvasInformation.getOrNull(engine.RootEntity),
    fov: cameraFovY(),
    pointer: pointerCanvasPx(),
    tool: state.activeAction,
    camMode: state.camMode,
    frozen: state.frozen,
    selected: [...state.selected],
    active,
    activeTransform: active === null ? null : (state.snapshot[active]?.Transform ?? null),
    worldOrigin: state.snapshot['5']?.Transform ?? null,
    anchor,
    anchorOnScreen: anchor === null ? null : projectWorldToScreen(anchor),
    samples
  }
  // engine components are read-only proxies, which the bus can't clone
  return JSON.parse(JSON.stringify(report))
}
