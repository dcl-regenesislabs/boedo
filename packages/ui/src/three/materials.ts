// The shared material library: photo-scanned tiling sets (materials/<name>/, CC0, see CREDITS.md).
// Every model that uses one points at the same files, written into the project once.
export const LIBRARY = [
  'stone-blocks', 'red-brick', 'old-brick', 'cobblestone', 'rock', 'mossy-rock',
  'planks', 'wood', 'bark', 'roof-tiles',
  'concrete', 'marble', 'floor-tiles',
  'metal', 'rusty-metal', 'metal-plate',
  'grass', 'sand', 'gravel', 'snow', 'ice'
] as const
export type LibraryName = (typeof LIBRARY)[number]

// orm: roughness in green, metalness in blue, as glTF's metallicRoughnessTexture reads them
export const MATERIAL_MAPS = ['color', 'normal', 'orm'] as const
export type MaterialMap = (typeof MATERIAL_MAPS)[number]

/** Where a material's map sits beside the models that use it. */
export const materialFile = (name: LibraryName, map: MaterialMap): string => `materials/${name}/${map}.jpg`

// natural surfaces read as repeating at one tile per metre
const WIDE: ReadonlySet<LibraryName> = new Set(['rock', 'mossy-rock', 'concrete', 'marble', 'grass', 'sand', 'gravel', 'snow', 'ice'])
export const metresPerTile = (name: LibraryName): number => (WIDE.has(name) ? 2 : 1)

export function isLibraryName(name: unknown): name is LibraryName {
  return typeof name === 'string' && (LIBRARY as readonly string[]).includes(name)
}
