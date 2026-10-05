import { useState } from 'react'
import { copySuffix, type SyncConflictChoice } from '@dcl-editor/contract'
import { state } from '@scene/state'
import { flushPendingSave } from '../../core/autosave'
import { useStore } from '../../core/store'
import { Button, Modal } from '../../ds'
import { registerCss } from '../../ds/styles/registry'
import css from './sync.css?inline'

registerCss('features/sync', 'features', css)

const choices = (copy: string): Array<{ choice: SyncConflictChoice; label: string; detail: string }> => [
  {
    choice: 'keep-both',
    label: 'Keep both',
    detail: `This device’s version is saved as a new scene, “${copy}”, and this scene becomes the account’s version. Nothing is lost.`
  },
  {
    choice: 'keep-local',
    label: 'Keep this device’s version',
    detail: 'Your account takes the version on this device. The other device’s changes are replaced.'
  },
  {
    choice: 'use-remote',
    label: 'Use the other version',
    detail: 'This scene becomes the version on your account. The changes made on this device are replaced.'
  }
]

// Both devices changed the scene. Nothing is merged: the creator picks, and until
// then the scene stays as it is here and is not synced. `unrelated`: the account
// holds another scene under this one's id, so only keeping both makes sense.
export function SyncConflictDialog(props: {
  project: string
  unrelated?: boolean
  onClose: () => void
  // the files of the scene here were replaced
  onReplaced: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<SyncConflictChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const title = useStore(() => state.scene?.title) ?? props.project
  const offered = choices(`${title} ${copySuffix(new Date())}`).filter(({ choice }) => props.unrelated !== true || choice === 'keep-both')
  const choose = (choice: SyncConflictChoice): void => {
    setBusy(choice)
    setError(null)
    // the choice is about the scene as it is now, the last edit included
    void flushPendingSave()
      .then(() => window.editorShell?.resolveSyncConflict?.(props.project, choice))
      .then(() => {
        if (choice === 'keep-local') props.onClose()
        else props.onReplaced()
      })
      .catch((e: unknown) => {
        setBusy(null)
        setError(e instanceof Error ? e.message : String(e))
      })
  }
  return (
    <Modal
      title={props.unrelated === true ? 'Your account has a different scene with this name' : 'This scene was changed on another device'}
      size="lg"
      onClose={busy === null ? props.onClose : undefined}
      scrimClose={false}
      closeX={busy === null}
      closeTip="Decide later"
      footer={
        <Button variant="ghost" size="md" disabled={busy !== null} onClick={props.onClose}>
          Decide later
        </Button>
      }
    >
      <p className="eui-sync-lead">
        {props.unrelated === true
          ? 'It was made on another device or before you signed in, and it is not this scene. Nothing has been replaced. Until you choose, this scene stays as it is on this device and is not synced.'
          : 'It was also changed here, so the two versions differ. Nothing has been replaced. Until you choose, this scene stays as it is on this device and is not synced.'}
      </p>
      <div className="eui-sync-choices">
        {offered.map(({ choice, label, detail }) => (
          <div key={choice} className="eui-sync-choice">
            <Button
              variant={choice === 'keep-both' ? 'primary' : 'secondary'}
              size="md"
              disabled={busy !== null}
              onClick={() => choose(choice)}
            >
              {busy === choice ? 'Working…' : label}
            </Button>
            <span>{detail}</span>
          </div>
        ))}
      </div>
      {error !== null && <p className="eui-sync-error">{error}</p>}
    </Modal>
  )
}
