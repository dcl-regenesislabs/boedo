import { type LiveSceneInfo } from './bevy-api/interface'

// Hosted (bevy-web): spawned beside the host's own privileged scene, which owns the
// session and the engine settings. Standalone (desktop): the only privileged scene.
export function hostedAmong(live: LiveSceneInfo[]): boolean {
  return live.filter((s) => s.isSuper).length > 1
}

// Until the boot proves this scene is alone, nothing here is ours to change.
// Scene-side only: the page bundles its own copy of this module, which nothing sets.
let hosted = true

export function isHosted(): boolean {
  return hosted
}

export function setHosted(value: boolean): void {
  hosted = value
}
