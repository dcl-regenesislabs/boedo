// The shared material library: photo-scanned tiling sets (materials/T_<Name>_D|N.jpg, CC0, see CREDITS.md).
// Every model that uses one points at the same files, written into the project once.
import properties from './materials/properties.json'
export const LIBRARY = [
  'stone-blocks', 'red-brick', 'old-brick', 'cobblestone', 'rock', 'mossy-rock',
  'planks', 'wood', 'bark', 'roof-tiles',
  'concrete', 'marble', 'floor-tiles',
  'metal', 'rusty-metal', 'metal-plate',
  'grass', 'sand', 'gravel', 'snow', 'ice'
] as const
export type LibraryName = (typeof LIBRARY)[number]

// two images a material, as each counts against the scene's texture limit; its roughness and
// metalness are the scan's averages
export const MATERIAL_MAPS = ['color', 'normal'] as const
export type MaterialMap = (typeof MATERIAL_MAPS)[number]

/** 'stone-blocks' → 'StoneBlocks': anything but letters and digits splits words, so no '_' survives. */
export const pascal = (name: string): string =>
  name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join('')

/** Where a material's map sits beside the models that use it, named the Decentraland way (T_<Name>_D / _N). */
export const materialFile = (name: LibraryName, map: MaterialMap): string => `materials/T_${pascal(name)}_${map === 'color' ? 'D' : 'N'}.jpg`

/** A library material's name: <Name>_MAT, plus each setting that differs from the scan's. */
export function libraryMaterialName(name: LibraryName, o: { color: string; roughness: number; metalness: number; relief: boolean }): string {
  const scan = surface(name)
  const [roughness, metalness] = [scan.roughness, scan.metalness].map((n) => Math.round(n * 100) / 100)
  return [
    `${pascal(name)}_MAT`,
    ...(o.color.toUpperCase() !== 'FFFFFF' ? [`Tint${o.color.toUpperCase()}`] : []),
    ...(o.relief ? [] : ['Flat']),
    ...(o.roughness !== roughness ? [`R${Math.round(o.roughness * 100)}`] : []),
    ...(o.metalness !== metalness ? [`M${Math.round(o.metalness * 100)}`] : [])
  ].join('_')
}

// natural surfaces read as repeating at one tile per metre
const WIDE: ReadonlySet<LibraryName> = new Set(['rock', 'mossy-rock', 'concrete', 'marble', 'grass', 'sand', 'gravel', 'snow', 'ice'])
export const metresPerTile = (name: LibraryName): number => (WIDE.has(name) ? 2 : 1)

export const surface = (name: LibraryName): { roughness: number; metalness: number } => properties[name]

export function isLibraryName(name: unknown): name is LibraryName {
  return typeof name === 'string' && (LIBRARY as readonly string[]).includes(name)
}
