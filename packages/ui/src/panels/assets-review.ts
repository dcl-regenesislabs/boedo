// Asks, from outside the Assets panel, to show it — and the older builds' delete confirmation with it.
import { reactive } from '../core/store'

// unusedOnly narrows My files to what the review is about, until the creator asks for everything again
export const assetsReview = reactive({ asks: 0, sweep: false, unusedOnly: false })

export function reviewAssets(sweepOlder: boolean): void {
  assetsReview.sweep = sweepOlder
  assetsReview.unusedOnly = true
  assetsReview.asks++
}

export function takeSweepRequest(): boolean {
  const asked = assetsReview.sweep
  if (asked) assetsReview.sweep = false
  return asked
}
