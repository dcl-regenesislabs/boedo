import { isRecord } from '../fields'

const TEXTURES = ['texture', 'emissiveTexture', 'bumpTexture', 'alphaTexture']

// The engine waits forever on an empty glTF or texture source and glows white for any emissive
// texture slot, so a Material never keeps one; opacity above 1 is a 0–255 mistake.
export function sanitizeMaterial(json: string): string {
  const value: unknown = JSON.parse(json)
  if (!isRecord(value)) return json
  if (isRecord(value.gltf) && !filled(value.gltf.gltfSrc)) delete value.gltf
  const material = isRecord(value.material) ? value.material : {}
  for (const surface of [material.pbr, material.unlit]) {
    if (!isRecord(surface)) continue
    for (const slot of TEXTURES) if (isRecord(surface[slot]) && emptyTexture(surface[slot])) delete surface[slot]
    for (const color of [surface.albedoColor, surface.diffuseColor]) {
      if (isRecord(color) && typeof color.a === 'number') color.a = Math.min(1, Math.max(0, color.a))
    }
  }
  return JSON.stringify(value)
}

function emptyTexture(union: Record<string, unknown>): boolean {
  if (!isRecord(union.tex)) return true
  return isRecord(union.tex.texture) && !filled(union.tex.texture.src)
}

function filled(src: unknown): boolean {
  return typeof src === 'string' && src.trim() !== ''
}
