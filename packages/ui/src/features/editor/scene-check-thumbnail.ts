import { isReservedEntity } from '@dcl-editor/contract'
import type { SceneCheck } from './scene-checks'

export const THUMBNAIL_CHECK_ID = 'no-thumbnail'
export const THUMBNAIL_FIX_ACTION = 'make-thumbnail'

// an empty new scene has nothing to show yet
export const sceneThumbnailCheck: SceneCheck = ({ thumbnailPath, snapshot }) => {
  if (thumbnailPath !== null || !Object.keys(snapshot).some((id) => !isReservedEntity(id))) return []
  return [{
    id: THUMBNAIL_CHECK_ID,
    level: 'warning',
    title: 'No thumbnail yet',
    detail: 'The map, the teleport prompt and Places show a 16:9 picture of the scene, 1920×1080, with the title and ' +
      'key subject in its central square. Ask the assistant to make one, or choose an image in Scene settings.',
    fix: { label: 'Make one with the assistant', action: THUMBNAIL_FIX_ACTION }
  }]
}
