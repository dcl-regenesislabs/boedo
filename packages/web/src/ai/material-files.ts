// The shared material images, served next to editor.js and held to the hashes written into it.
import { fetchVerified } from '@dcl-editor/web-build'
import { materialFile, type LibraryName, type MaterialMap } from '@ui/three/materials'
import { fileIntegrity } from '../workers'

let base: string | null = null
export function setMaterialBase(editorBase: string): void {
  base = editorBase
}

export async function materialBytes(name: LibraryName, map: MaterialMap): Promise<Uint8Array<ArrayBuffer>> {
  if (base === null) throw new Error('The shared materials are not available here.')
  const file = materialFile(name, map)
  const response = await fetchVerified(new URL(file, base).href, fileIntegrity(file), file)
  return new Uint8Array(await response.arrayBuffer())
}
