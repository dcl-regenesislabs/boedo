// A project out of the browser as a .zip, and one in from a .zip or a folder.
import type { ProjectImportReport, ProjectImportResult } from '@dcl-editor/contract'
import { type ImportEntry, folderEntries, folderPicker, planImport, zipEntries } from '../archive/import'
import { writeZip } from '../archive/zip'

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Resolves null when the picker is dismissed.
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export const canPickFolder = (): boolean => folderPicker() !== null

export async function downloadZip(name: string, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
  const sorted = [...files].sort(([a], [b]) => a.localeCompare(b))
  const zip = await writeZip(sorted)
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'scene'}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function picked(kind: 'zip' | 'folder'): Promise<{ name: string; entries: ImportEntry[] } | null> {
  if (kind === 'zip') {
    const file = await pickFile('.zip,application/zip')
    if (file === null) return null
    return { name: file.name.replace(/\.zip$/i, ''), entries: zipEntries(new Uint8Array(await file.arrayBuffer())) }
  }
  const picker = folderPicker()
  if (picker === null) throw new Error('This browser cannot open a folder. Zip the scene folder and import the .zip.')
  try {
    const folder = await picker({ mode: 'read' })
    return { name: folder.name, entries: await folderEntries(folder) }
  } catch (error) {
    // the picker was dismissed
    if (error instanceof Error && error.name === 'AbortError') return null
    throw error
  }
}

// `create` stores the files as a new project and resolves its id.
export async function importProject(
  kind: 'zip' | 'folder',
  create: (title: string, files: Map<string, Uint8Array>) => Promise<string>
): Promise<ProjectImportResult | null> {
  try {
    const source = await picked(kind)
    if (source === null) return null
    const outcome = await planImport(source.name, source.entries)
    if (!outcome.ok) return outcome
    const { title, files, skipped, warnings, needsPackages } = outcome.plan
    const report: ProjectImportReport = {
      id: await create(title, files),
      title,
      files: files.size,
      skipped,
      warnings,
      needsPackages
    }
    return { ok: true, report }
  } catch (error) {
    return { ok: false, reason: describe(error) }
  }
}
