import { useEffect, useRef, useState } from 'react'
import { Toast } from '../../ds'
import { publishWatched, usePublish } from './publish-flow'

// A publish whose modal was hidden still says how it ended.
export function PublishOutcomeToast(): JSX.Element | null {
  const job = usePublish()
  const [said, setSaid] = useState<string | null>(null)
  const last = useRef(job.phase)
  useEffect(() => {
    const was = last.current
    last.current = job.phase
    if ((was !== 'building' && was !== 'uploading') || publishWatched()) return
    const world = job.world ?? 'your world'
    if (job.phase === 'success') setSaid(`${world} is live!`)
    else if (job.phase === 'error') setSaid(`Publishing to ${world} failed. Open Publish to see why.`)
  }, [job.phase, job.world])
  useEffect(() => {
    if (said === null) return
    const t = setTimeout(() => setSaid(null), 8000)
    return () => clearTimeout(t)
  }, [said])
  return said === null ? null : <Toast>{said}</Toast>
}
