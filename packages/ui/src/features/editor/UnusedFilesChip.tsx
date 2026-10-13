// Files nothing uses, said over the viewport: the Assets panel and Scene insights only tell a creator who opens them.
import { useEffect, useState } from 'react'
import { state } from '@scene/state'
import { LinkButton, Toast } from '../../ds'
import { useStore } from '../../core/store'
import { olderBuilds, unusedModelFiles, unusedModelsKey } from '../../project-file-use'
import { reviewAssets } from '../../panels/assets-review'
import { toggleInsights, useInsightsOpen } from './SceneInsightsDock'

// polled like the insights dock: the key scans the whole snapshot, and a gizmo drag notifies every frame
const POLL_MS = 2000
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
  const [found, setFound] = useState<{ unused: string[]; older: string[] } | null>(null)
  const [, setDismissals] = useState(0)

  useEffect(() => {
    let alive = true
    let checkedFor = ''
    let checking = false
    const check = async (): Promise<void> => {
      const key = unusedModelsKey()
      if (checking || key === checkedFor) return
      checking = true
      checkedFor = key
      const [unused, older] = await Promise.all([unusedModelFiles().catch(() => []), olderBuilds().catch(() => [])])
      checking = false
      if (alive) setFound({ unused, older })
    }
    void check()
    const timer = setInterval(() => void check(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (found === null || !editing || toastShown || insightsOpen) return null
  const { unused, older } = found
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
