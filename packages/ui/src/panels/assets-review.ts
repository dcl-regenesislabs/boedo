// Asks, from outside the Assets panel, to show it narrowed to the files nothing uses.
import { reactive } from '../core/store'

// unusedOnly narrows My files to what the review is about, until the creator asks for everything again
export const assetsReview = reactive({ asks: 0, unusedOnly: false })

export function reviewAssets(): void {
  assetsReview.unusedOnly = true
  assetsReview.asks++
}
