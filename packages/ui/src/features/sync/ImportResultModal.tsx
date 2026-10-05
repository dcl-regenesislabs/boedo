import { useEffect, useState } from 'react'
import type { ProjectImportResult, ProjectPackages } from '@dcl-editor/contract'
import { Button, Modal } from '../../ds'
import { registerCss } from '../../ds/styles/registry'
import css from './sync.css?inline'

registerCss('features/sync', 'features', css)

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

// Where the imported scene's npm packages stand: the shell starts downloading
// them as the import lands.
function usePackages(id: string | null): ProjectPackages | null {
  const [status, setStatus] = useState<ProjectPackages | null>(null)
  useEffect(() => {
    const shell = window.editorShell
    if (id === null || shell?.onProjectPackages === undefined) return
    const stop = shell.onProjectPackages((dir, packages) => {
      if (dir === id) setStatus(packages)
    })
    void shell.projectPackages?.(id).then((packages) => {
      if (packages !== null) setStatus((now) => now ?? packages)
    })
    return stop
  }, [id])
  return status
}

function packagesLine(status: ProjectPackages | null): string {
  if (status === null) return 'Getting them ready…'
  if (status.state === 'installing') {
    return status.progress === undefined ? 'Downloading…' : `Downloading… ${status.progress.done} of ${status.progress.total}`
  }
  if (status.state === 'error') return status.message ?? 'They could not be installed.'
  const own = Object.entries(status.installed).map(([name, version]) => `${name} ${version}`)
  const others = status.total - own.length
  return `Ready: ${own.join(', ')}${others > 0 ? `, and ${count(others, 'package')} they depend on` : ''}.`
}

// What an import brought in, what it left out, and what the editor cannot do with it.
export function ImportResultModal(props: {
  result: ProjectImportResult
  onClose: () => void
  onOpen: (id: string) => void
}): JSX.Element {
  const { result } = props
  const needed = result.ok ? Object.keys(result.report.needsPackages) : []
  const packages = usePackages(result.ok && needed.length > 0 ? result.report.id : null)
  if (!result.ok) {
    return (
      <Modal
        title="This could not be imported"
        size="md"
        onClose={props.onClose}
        footer={<Button variant="primary" size="md" onClick={props.onClose}>OK</Button>}
      >
        <p className="eui-import-lead">{result.reason}</p>
      </Modal>
    )
  }
  const { report } = result
  return (
    <Modal
      title="Scene imported"
      size="md"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={props.onClose}>Done</Button>
          <Button variant="primary" size="md" onClick={() => props.onOpen(report.id)}>
            {packages?.state === 'error' ? 'Open it to fix it' : 'Open scene'}
          </Button>
        </>
      }
    >
      <p className="eui-import-lead">
        “{report.title}” is now one of your scenes ({count(report.files, 'file')}).
      </p>
      {report.skipped > 0 && (
        <p className="eui-import-lead">
          {count(report.skipped, 'file')} left out: installed packages, build output, git history and .env files are
          never imported.
        </p>
      )}
      {needed.length > 0 && (
        <>
          <p className="eui-import-lead">
            It uses {count(needed.length, 'package')} from npm ({needed.join(', ')}). They are downloaded once, checked
            against their checksums and frozen into the scene, so it builds the same on every device and with no
            connection.
          </p>
          <p className="eui-import-packages" data-state={packages?.state ?? 'installing'}>
            {packagesLine(packages)}
          </p>
        </>
      )}
      {report.warnings.length + (packages?.warnings.length ?? 0) > 0 && (
        <ul className="eui-import-list">
          {[...report.warnings, ...(packages?.warnings ?? [])].map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
