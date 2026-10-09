import { useEffect } from 'react'
import type { ProjectSync } from '@dcl-editor/contract'
import { AutoSaveChip, Button } from '../../ds'
import { useStore } from '../../core/store'
import { SyncConflictDialog } from './SyncConflictDialog'
import { conflictAsk, syncLabel, useSyncStatus } from './sync'

const TIPS: Record<string, string> = {
  syncing: 'Copying your changes to your account',
  synced: 'Your account has this version of the scene',
  offline: 'No connection: your changes are kept on this device and sync when it is back'
}

function chipState(state: ProjectSync['state']): 'ok' | 'err' | 'dim' {
  if (state === 'synced') return 'ok'
  return state === 'error' ? 'err' : 'dim'
}

// Where the open scene's copy on the account stands. Nothing is shown when no
// copy is kept (a guest, or a page without the project service).
export function SyncChip(props: { project: string }): JSX.Element | null {
  const sync = useSyncStatus()?.projects[props.project]
  const label = syncLabel(sync)
  if (sync === undefined || label === null) return null
  if (sync.state === 'conflict') {
    return (
      <Button variant="danger" size="sm" className="eui-sync-conflict" tip="Choose which version to keep" onClick={() => (conflictAsk.open = true)}>
        {label}
      </Button>
    )
  }
  return (
    <AutoSaveChip
      state={chipState(sync.state)}
      tip={sync.state === 'error' ? sync.message : TIPS[sync.state]}
      role={sync.state === 'error' ? 'alert' : undefined}
    >
      {label}
    </AutoSaveChip>
  )
}

// The conflict question for the open scene. Outside the top bar: a dialog inside
// it would sit under the floating toolbar.
export function SyncConflictGate(props: { project: string }): JSX.Element | null {
  const sync = useSyncStatus()?.projects[props.project]
  const conflict = sync?.state === 'conflict'
  const open = useStore(() => conflictAsk.open)
  useEffect(() => {
    conflictAsk.open = conflict
  }, [conflict])
  if (!open || !conflict) return null
  return (
    <SyncConflictDialog
      project={props.project}
      unrelated={sync?.unrelated}
      onClose={() => (conflictAsk.open = false)}
      onReplaced={() => void window.editorShell?.openProject(props.project)}
    />
  )
}
