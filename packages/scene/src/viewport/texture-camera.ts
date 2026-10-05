import { TextureCamera, type Entity, type PBTextureCamera } from '@dcl/sdk/ecs'

export type TextureCameraPatch = { fieldOfView?: number; width?: number; height?: number }

// What differs from the camera we want, or null when nothing does.
export function textureCameraPatch(
  current: PBTextureCamera,
  fov: number | null,
  size: { width: number; height: number } | null
): TextureCameraPatch | null {
  const patch: TextureCameraPatch = {}
  if (fov !== null && current.mode?.$case === 'perspective' && current.mode.perspective.fieldOfView !== fov) {
    patch.fieldOfView = fov
  }
  if (size !== null && (current.width !== size.width || current.height !== size.height)) {
    patch.width = size.width
    patch.height = size.height
  }
  return Object.keys(patch).length === 0 ? null : patch
}

// Writes only a real change: the engine rebuilds its camera on every TextureCamera
// update, and getMutable sends one even when nothing changed.
export function syncTextureCamera(
  cam: Entity,
  fov: number | null,
  size: { width: number; height: number } | null
): void {
  const current = TextureCamera.getOrNull(cam)
  if (current === null) return
  const patch = textureCameraPatch(current, fov, size)
  if (patch === null) return
  const tc = TextureCamera.getMutable(cam)
  if (patch.fieldOfView !== undefined && tc.mode?.$case === 'perspective') tc.mode.perspective.fieldOfView = patch.fieldOfView
  if (patch.width !== undefined) tc.width = patch.width
  if (patch.height !== undefined) tc.height = patch.height
}
