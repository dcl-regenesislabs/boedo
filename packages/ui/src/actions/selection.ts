// Selection, tool and camera. Each change mirrors to the scene over the bus so
// the gizmos stay in sync with what the panels show.
import { state, selectionClick, setActiveAction, clearSelection, provenanceBaseline } from '@scene/state'
import { type EditorTool, type CameraMode } from '@scene/bridge-protocol'
import { sendToScene } from '../engine/bus'
import { sceneFrameIds } from '../panels/hierarchy-model'
import { authoredFromComposite } from '../panels/authored-ids'

export function syncSelectionToScene(): void {
  void sendToScene({
    type: 'set-selection',
    selected: [...state.selected],
    active: state.activeEntity
  })
}

export function uiSelectEntity(id: string, additive: boolean, toggle: boolean): void {
  selectionClick(id, additive, toggle)
  syncSelectionToScene()
}

export function uiClearSelection(): void {
  clearSelection()
  syncSelectionToScene()
}

export function uiSetTool(tool: EditorTool): void {
  setActiveAction(tool)
  void sendToScene({ type: 'set-tool', tool: state.activeAction as EditorTool })
}

export function uiSetCamera(mode: CameraMode, axis?: string): void {
  state.camMode = mode === 'off' ? 'none' : mode
  void sendToScene({ type: 'set-camera', mode, axis })
}

export function uiFocusEntity(id: string): void {
  state.camMode = 'free' // focus flies the free camera to it; it never orbits
  void sendToScene({ type: 'focus', entity: id })
}

// The frame button and shortcut: the selection, or the whole scene when nothing is selected.
export function uiFrameSelectionOrScene(): void {
  const selected = [...state.selected]
  const single = selected.length > 1 ? null : (state.activeEntity ?? selected[0] ?? null)
  if (single !== null) {
    uiFocusEntity(single)
    return
  }
  const ids = selected.length > 1 ? selected : sceneFrameIds(state.snapshot, provenanceBaseline(), authoredFromComposite())
  if (ids.length === 0) return
  state.camMode = 'free'
  void sendToScene({ type: 'frame', entities: ids })
}

// A fresh entity wants its gizmo: hop from the select tool to move so the
// just-created/imported model can be placed immediately.
export function ensureTransformTool(): void {
  if (state.activeAction === 'select') uiSetTool('translate')
}

// Whatever was just dropped lands at the parcel centre — fly the camera to it so
// it's actually visible (otherwise it lands off-screen and feels like nothing happened).
export function focusPlaced(): void {
  if (state.activeEntity === null) return
  state.camMode = 'free'
  void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false })
}
