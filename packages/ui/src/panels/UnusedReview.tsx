import { useState } from 'react'
import { Button, Modal, Notice } from '../ds'
import { deleteProjectFile } from '../project-file-use'
import { assetsReview } from './assets-review'

export function UnusedReview(props: { files: string[]; onDeleted: () => void }): JSX.Element {
  const [confirm, setConfirm] = useState<{ busy?: boolean; error?: string } | null>(null)
  const n = props.files.length
  const deleteAll = async (): Promise<void> => {
    setConfirm({ busy: true })
    try {
      for (const path of props.files) await deleteProjectFile(path)
      setConfirm(null)
      props.onDeleted()
    } catch (e) {
      setConfirm({ error: e instanceof Error ? e.message : String(e) })
      props.onDeleted()
    }
  }
  return (
    <>
      <Notice tone="attention" onDismiss={() => (assetsReview.unusedOnly = false)} dismissTip="Show all my files">
        {n === 0 ? (
          <>Nothing unused is left. Close this to see all your files.</>
        ) : (
          <>
            <strong>Showing {n === 1 ? '1 unused file' : `${n} unused files`}.</strong> Nothing placed in the scene or named by a script uses them. Right-click one to delete it, or delete them all.
            <span className="eui-unused-review-act">
              <Button variant="danger" size="xs" onClick={() => setConfirm({})}>
                Delete all {n}
              </Button>
            </span>
          </>
        )}
      </Notice>
      {confirm !== null && (
        <Modal
          title={`Delete ${n === 1 ? '1 unused file' : `${n} unused files`}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" disabled={confirm.busy === true} onClick={() => void deleteAll()}>
                Delete
              </Button>
            </>
          }
        >
          <p>They are removed from the project. Nothing in the scene or its scripts uses them, and undo can’t bring them back.</p>
          <ul>
            {props.files.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
          {confirm.error !== undefined && <p role="alert">{confirm.error}</p>}
        </Modal>
      )}
    </>
  )
}
