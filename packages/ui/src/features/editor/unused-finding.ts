// Files nothing uses, as a finding in the scene-checks card rather than a second pill of its own.
import { reviewAssets } from '../../panels/assets-review'
import type { SceneFinding } from './scene-checks'

export const REVIEW_UNUSED_ACTION = 'review-unused'

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

export function unusedFilesFinding(unused: string[] | null, older: string[] | null): SceneFinding | null {
  if (unused === null || older === null || unused.length + older.length === 0) return null
  const what = [unused.length > 0 ? plural(unused.length, 'file') : '', older.length > 0 ? plural(older.length, 'older build') : ''].filter(Boolean).join(' and ')
  return {
    // the paths make the identity, so a new unused file brings a dismissed card back
    id: `unused-files:${[...unused, ...older].sort().join('|')}`,
    level: 'warning',
    title: older.length > 0 && unused.length === 0 ? 'Older builds to clean up' : 'Unused files',
    detail: `${what} that nothing placed in the scene or named by a script uses. Review them in Assets and delete what you don't need.`,
    fix: { label: 'Review', action: REVIEW_UNUSED_ACTION }
  }
}

export function reviewUnusedFiles(): void {
  reviewAssets()
}
