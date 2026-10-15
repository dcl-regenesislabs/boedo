import { useState } from 'react'
import { FileRail } from '../features/ai/FileRail'
import { FilePreviewModal } from '../features/ai/FilePreview'
import { isEditable } from '../script/project-files'
import { openStudio } from './ai-store'

export function AssetsFileTree(props: { query: string; reloadKey: number }): JSX.Element {
  const [viewing, setViewing] = useState<string | null>(null)
  return (
    <>
      <FileRail fill query={props.query} active={viewing} reloadKey={props.reloadKey} onOpen={(p) => (isEditable(p) ? openStudio(p) : setViewing(p))} />
      {viewing !== null && <FilePreviewModal path={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
