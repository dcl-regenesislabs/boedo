// Files nothing uses, said over the viewport: the Assets panel and Scene insights only tell a creator who opens them.
import { useState } from 'react'
import { state } from '@scene/state'
import { LinkButton, Toast } from '../../ds'
import { useStore } from '../../core/store'
import { useUnusedFiles } from '../../unused-files'
import { reviewAssets } from '../../panels/assets-review'
import { toggleInsights, useInsightsOpen } from './SceneInsightsDock'

const MODEL = /\.(glb|gltf)$/i

// module state, so a Play and back does not bring a dismissed chip back
let dismissed = ''

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

function unusedFilesText(unused: number, older: number): string {
  return [unused > 0 ? plural(unused, 'unused file') : '', older > 0 ? plural(older, 'older build') : ''].filter(Boolean).join(' · ')
}

export function UnusedFilesChip(): JSX.Element | null {
  const editing = useStore(() => state.frozen)
  // the save toast takes the same spot, and the open dock already lists them
  const toastShown = useStore(() => state.saveStatus !== '')
  const insightsOpen = useInsightsOpen()
  const hidden = !editing || toastShown || insightsOpen
  const { unused, older } = useUnusedFiles(!hidden)
  const [, setDismissals] = useState(0)

  if (unused === null || older === null || hidden) return null
  const signature = `${unused.length}|${older.length}`
  if (unused.length + older.length === 0 || signature === dismissed) return null

  const review = (): void => {
    if (older.length > 0 || unused.some((f) => MODEL.test(f))) reviewAssets(older.length > 0)
    else toggleInsights()
  }
  const dismiss = (): void => {
    dismissed = signature
    setDismissals((n) => n + 1)
  }
  return (
    <Toast>
      ⚠ {unusedFilesText(unused.length, older.length)}
      <LinkButton className="notes" onClick={review}>Review</LinkButton>
      <LinkButton onClick={dismiss}>Dismiss</LinkButton>
    </Toast>
  )
}
