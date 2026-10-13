// The shared sound library: Kenney's CC0 sounds (sounds/<name>.mp3, see CREDITS.md), written into a
// project once, when the assistant first uses one.
import properties from './sounds/properties.json'
export const SOUNDS = [
  'coin', 'gem', 'power-up', 'point',
  'countdown-tick', 'start', 'win', 'lose', 'time-up',
  'click', 'open', 'close', 'error',
  'jump', 'land', 'hit', 'splat', 'teleport',
  'door-open', 'door-close', 'lever', 'explosion',
  'fire-loop', 'rumble-loop', 'machine-loop'
] as const
export type SoundName = (typeof SOUNDS)[number]

/** Where a sound is served beside editor.js. */
export const soundFile = (name: SoundName): string => `sounds/${name}.mp3`
/** Where a sound sits in the project: its own folder, so a creator's assets/audio/<name>.mp3 is never mistaken for it. */
export const soundProjectPath = (name: SoundName): string => `assets/audio/library/${name}.mp3`

export const soundInfo = (name: SoundName): { description: string; durationSeconds: number; loop: boolean } => properties[name]

export function isSoundName(name: unknown): name is SoundName {
  return typeof name === 'string' && (SOUNDS as readonly string[]).includes(name)
}
