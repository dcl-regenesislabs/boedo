import { isUiEntity } from '@scene/state'
import { isReservedEntity } from '@dcl-editor/contract'
import { insideParcels } from '@scene/out-of-bounds'
import { computeWorldPositions } from '@scene/world-pos'
import { entityName } from '@scene/custom-components'
import { INERT_COMPONENT } from '../../prefabs/format'
import type { SceneCheck } from './scene-checks'

// Decentraland's height limit, the same for any number of parcels
export const MAX_SCENE_HEIGHT = 330

export const sceneBoundsCheck: SceneCheck = ({ snapshot, parcels }) => {
  if (parcels === undefined || parcels.length === 0) return []
  const positions = computeWorldPositions(snapshot)
  if (positions === null) return []
  const height = MAX_SCENE_HEIGHT
  const flagged = new Set([...positions].flatMap(([id, position]) => {
    if (isReservedEntity(id) || snapshot[id]?.Transform === undefined || isUiEntity(snapshot, id) || snapshot[id]?.[INERT_COMPONENT] !== undefined) return []
    return insideParcels(position, parcels) && position.y <= height ? [] : [id]
  }))
  const parentOf = (id: string): string | undefined => {
    const parent = (snapshot[id]?.Transform as { parent?: number } | undefined)?.parent
    return parent === undefined || parent === 0 ? undefined : String(parent)
  }
  const underFlagged = (id: string): boolean => {
    const seen = new Set([id])
    for (let p = parentOf(id); p !== undefined && !seen.has(p); p = parentOf(p)) {
      if (flagged.has(p)) return true
      seen.add(p)
    }
    return false
  }
  return [...flagged].filter(id => !underFlagged(id)).map(id => {
    const position = positions.get(id) ?? { x: 0, y: 0, z: 0 }
    return {
      id: 'outside-scene-bounds', level: 'warning' as const, entityId: id,
      title: `${entityName(snapshot, id) ?? id} is outside the playable scene`,
      detail: `Its origin is at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}) in world metres. Move it inside the live parcels (${parcels.map(p => `${p.x},${p.y}`).join(' · ')}), below ${height} m, or expand the scene and wait for the preview to load.`
    }
  })
}
