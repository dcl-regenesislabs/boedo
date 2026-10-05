import { NAME_COMPONENT } from '@scene/custom-components'
import { SCRIPT_COMPONENT, TRIGGER_AREA } from '@scene/allowed-components'
import { prettyLabel } from './fields'

export const COMPONENT_GROUPS = ['Looks', 'Interaction', 'Audio & video', 'Camera & avatar', 'Advanced', 'Other'] as const
export type ComponentGroup = (typeof COMPONENT_GROUPS)[number]

export interface CatalogEntry {
  label: string
  group: ComponentGroup
  description: string
}

const CATALOG: Record<string, CatalogEntry> = {
  Material: { label: 'Material', group: 'Looks', description: 'Color, texture and shine of a shape or model' },
  MeshRenderer: { label: 'Mesh', group: 'Looks', description: 'A basic shape: box, sphere, plane or cylinder' },
  GltfContainer: { label: 'Model', group: 'Looks', description: 'A 3D model loaded from a .glb or .gltf file' },
  TextShape: { label: 'Text', group: 'Looks', description: 'Text floating in the world' },
  LightSource: { label: 'Light', group: 'Looks', description: 'A point or spot light' },
  Billboard: { label: 'Billboard', group: 'Looks', description: 'Always turns to face the camera' },
  VisibilityComponent: { label: 'Visibility', group: 'Looks', description: 'Show or hide the entity' },
  NftShape: { label: 'NFT frame', group: 'Looks', description: 'Frames an NFT image from the blockchain' },
  GltfNodeModifiers: { label: 'Model overrides', group: 'Looks', description: 'Swap materials or hide parts of a model' },

  PointerEvents: { label: 'Pointer events', group: 'Interaction', description: 'Hover and click prompts for the player' },
  [TRIGGER_AREA]: { label: 'Trigger area', group: 'Interaction', description: 'A volume that reacts when someone walks in' },
  Tween: { label: 'Tween', group: 'Interaction', description: 'Move, rotate or scale smoothly over time' },
  TweenSequence: { label: 'Tween sequence', group: 'Interaction', description: 'Chain or loop tweens' },
  Animator: { label: 'Animator', group: 'Interaction', description: "Play a model's animations" },
  [SCRIPT_COMPONENT]: { label: 'Script', group: 'Interaction', description: 'Run your own code on this entity' },

  AudioSource: { label: 'Sound', group: 'Audio & video', description: 'Play an audio clip from the scene' },
  AudioStream: { label: 'Audio stream', group: 'Audio & video', description: 'Stream audio from a URL' },
  VideoPlayer: { label: 'Video player', group: 'Audio & video', description: 'Play a video file or stream' },

  VirtualCamera: { label: 'Virtual camera', group: 'Camera & avatar', description: 'A fixed or following camera angle' },
  MainCamera: { label: 'Main camera', group: 'Camera & avatar', description: 'Switch the player view to a virtual camera' },
  CameraModeArea: { label: 'Camera mode area', group: 'Camera & avatar', description: 'Force first or third person inside a volume' },
  AvatarAttach: { label: 'Attach to avatar', group: 'Camera & avatar', description: "Stick the entity to a player's hand or head" },
  AvatarShape: { label: 'Avatar (NPC)', group: 'Camera & avatar', description: 'An avatar with its own wearables' },
  AvatarModifierArea: { label: 'Avatar modifier area', group: 'Camera & avatar', description: 'Hide avatars or disable passports inside a volume' },

  InputModifier: { label: 'Input modifier', group: 'Advanced', description: "Block the player's movement or actions" },
  SkyboxTime: { label: 'Skybox time', group: 'Advanced', description: 'Fix the time of day for the sky' },
  MeshCollider: { label: 'Collider', group: 'Advanced', description: 'Invisible shape that blocks or detects clicks' },
  [NAME_COMPONENT]: { label: 'Name', group: 'Advanced', description: 'A label for finding the entity in code' }
}

export function catalogEntry(name: string): CatalogEntry {
  const known = CATALOG[name]
  if (known !== undefined) return known
  const short = name.includes('::') ? name.slice(name.indexOf('::') + 2) : name
  return { label: prettyLabel(short), group: 'Other', description: '' }
}

export function matchesComponent(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const e = catalogEntry(name)
  return e.label.toLowerCase().includes(q) || name.toLowerCase().includes(q)
}

export function groupComponents(names: string[]): Array<{ group: ComponentGroup; names: string[] }> {
  return COMPONENT_GROUPS.map((group) => ({
    group,
    names: names
      .filter((n) => catalogEntry(n).group === group)
      .sort((a, b) => catalogEntry(a).label.localeCompare(catalogEntry(b).label))
  })).filter((g) => g.names.length > 0)
}
