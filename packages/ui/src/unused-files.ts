// One scan of the files nothing uses, shared by the viewport chip, the insights dock and the Assets panel.
import { useEffect } from 'react'
import { reactive, useStore } from './core/store'
import { onDataLayerWrite } from './engine/datalayer'
import { noteFileWrite, olderBuilds, unusedModelFiles, unusedModelsKey } from './project-file-use'

// polled: the key reads the whole snapshot, and a gizmo drag notifies every frame
const POLL_MS = 2000

// null until the first scan finishes
export const unusedFiles = reactive({ unused: null as string[] | null, older: null as string[] | null })

let scannedFor = ''
let scanning = false
let forcedWhileScanning = false
export async function refreshUnusedFiles(force = false): Promise<void> {
  const key = unusedModelsKey()
  if (scanning) {
    forcedWhileScanning ||= force
    return
  }
  if (!force && key === scannedFor) return
  scanning = true
  scannedFor = key
  const [unused, older] = await Promise.all([unusedModelFiles().catch(() => []), olderBuilds().catch(() => [])])
  unusedFiles.unused = unused
  unusedFiles.older = older
  scanning = false
  if (forcedWhileScanning) {
    forcedWhileScanning = false
    await refreshUnusedFiles(true)
  }
}

onDataLayerWrite(noteFileWrite)

let watchers = 0
let timer: ReturnType<typeof setInterval> | undefined
function watch(): () => void {
  watchers++
  void refreshUnusedFiles()
  timer ??= setInterval(() => void refreshUnusedFiles(), POLL_MS)
  return () => {
    watchers--
    if (watchers > 0) return
    clearInterval(timer)
    timer = undefined
  }
}

export function useUnusedFiles(active = true): { unused: string[] | null; older: string[] | null } {
  useEffect(() => (active ? watch() : undefined), [active])
  return { unused: useStore(() => unusedFiles.unused), older: useStore(() => unusedFiles.older) }
}
