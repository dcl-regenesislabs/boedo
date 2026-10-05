// Files shipped inside the bundle: the New-scene starters (the desktop app's
// templates, read at build time) and the SDK runtime's type declarations.
import type { SceneTemplate } from '@dcl-editor/contract'

const TEMPLATES_ROOT = '../../../desktop/templates/'
const TEMPLATE_SOURCES = import.meta.glob<string>('../../../desktop/templates/**/*', {
  eager: true,
  query: '?raw',
  import: 'default'
})

const TEMPLATES: SceneTemplate[] = [
  { id: 'blank', name: 'Blank', description: 'An empty parcel — start from scratch' },
  { id: 'starter', name: 'Example', description: 'A clickable cube with a bit of SDK7 code' }
]

export function templateFiles(id: string): Map<string, Uint8Array> {
  const prefix = `${TEMPLATES_ROOT}${id}/`
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  for (const [path, text] of Object.entries(TEMPLATE_SOURCES)) {
    if (path.startsWith(prefix)) files.set(path.slice(prefix.length), encoder.encode(text))
  }
  return files
}

export function sceneTemplates(): SceneTemplate[] {
  return TEMPLATES.filter((template) => templateFiles(template.id).size > 0)
}

// The code editor types console, fetch and the ~system modules from the
// project's node_modules/@dcl/js-runtime, and a project here has no node_modules.
const RUNTIME_ROOT = '../../../../node_modules/@dcl/js-runtime/'
const RUNTIME_TYPES = import.meta.glob<string>('../../../../node_modules/@dcl/js-runtime/*.d.ts', {
  eager: true,
  query: '?raw',
  import: 'default'
})

export function runtimeTypes(path: string): Uint8Array | undefined {
  const prefix = 'node_modules/@dcl/js-runtime/'
  const text = path.startsWith(prefix) ? RUNTIME_TYPES[RUNTIME_ROOT + path.slice(prefix.length)] : undefined
  return text === undefined ? undefined : new TextEncoder().encode(text)
}
