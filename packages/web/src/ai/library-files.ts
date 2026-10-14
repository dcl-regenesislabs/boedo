// The shared material images and sounds, served next to editor.js and held to the hashes written into it.
import { fetchVerified } from '@dcl-editor/scene-compiler'
import { materialFile, type LibraryName, type MaterialMap } from '@ui/three/materials'
import { soundFile, type SoundName } from '@ui/sounds'
import { fileIntegrity } from '../workers'

let base: string | null = null
export function setLibraryBase(editorBase: string): void {
  base = editorBase
}

async function libraryBytes(file: string): Promise<Uint8Array<ArrayBuffer>> {
  if (base === null) throw new Error('The shared library is not available here.')
  const response = await fetchVerified(new URL(file, base).href, fileIntegrity(file), file)
  return new Uint8Array(await response.arrayBuffer())
}

export const materialBytes = (name: LibraryName, map: MaterialMap): Promise<Uint8Array<ArrayBuffer>> => libraryBytes(materialFile(name, map))
export const soundBytes = (name: SoundName): Promise<Uint8Array<ArrayBuffer>> => libraryBytes(soundFile(name))
