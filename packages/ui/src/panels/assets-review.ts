// Asks, from outside the Assets panel, to show it — and the older builds' delete confirmation with it.
import { reactive } from '../core/store'

export const assetsReview = reactive({ asks: 0, sweep: false })

export function reviewAssets(sweepOlder: boolean): void {
  assetsReview.sweep = sweepOlder
  assetsReview.asks++
}

export function takeSweepRequest(): boolean {
  const asked = assetsReview.sweep
  if (asked) assetsReview.sweep = false
  return asked
}
