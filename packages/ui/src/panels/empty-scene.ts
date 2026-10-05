// "Is there anything of the creator's in here yet?" — the one signal the
// empty-scene affordances share (the first-run left tab, the Prefabs panel's
// built-ins-first ordering, the hierarchy's start CTA).
//
// Answers null while the answer would be a guess, because "no authored entities"
// and "provenance hasn't arrived" look identical from here, and acting on the
// second would send someone with a full scene to the Prefabs tab. Reuses the
// memoised hierarchy model, so asking costs a cache hit once the tree has built
// it — and builds the same model the tree would when it is closed.
import { state, provenanceBaseline, type Snapshot } from '@scene/state'
import { authoredIds, hierarchyModel } from './hierarchy-model'
import { authoredFromComposite } from './authored-ids'
import { isHosted } from '../engine/hosted'

// Hosted, ready-made prefabs come from the shell's library, and a shell may have
// none: an empty scene is then not sent to an empty Prefabs tab.
export function hasReadyMadePrefabs(): boolean {
  return !isHosted() || window.editorShell?.prefabLibraryList !== undefined
}

export function sceneEmptiness(): boolean | null {
  if (state.status !== 'ready') return null
  const snapshot = state.snapshot as Snapshot
  const baseline = provenanceBaseline()
  const fromComposite = authoredFromComposite()
  // the same union hierarchyModel classifies with: with neither signal it falls
  // back to a named-only tree, whose emptiness says nothing about authorship
  if (baseline === null && fromComposite === null && authoredIds(snapshot) === null) return null
  return hierarchyModel(snapshot, baseline, true, fromComposite).counts.static === 0
}
