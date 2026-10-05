// The built-in prefabs the desktop app ships, copied as files under
// <out>/prefabs/ with a catalog of every folder's data.json and each file's
// sha384. The build pins the catalog's own hash in editor.js, so one integrity
// covers them all (src/shell/builtin-prefabs.ts).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'bin', 'dist'])

export const sri = (bytes) => `sha384-${crypto.createHash('sha384').update(bytes).digest('base64')}`

function filesUnder(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name) || entry.isSymbolicLink()) return []
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`
    return entry.isDirectory() ? filesUnder(dir, child) : entry.isFile() ? [child] : []
  })
}

export function writePrefabCatalog(src, out) {
  const catalog = []
  for (const entry of fs.readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(src, entry.name)
    if (!entry.isDirectory() || !fs.existsSync(path.join(folder, 'data.json'))) continue
    const files = {}
    for (const rel of filesUnder(folder).sort()) {
      const bytes = fs.readFileSync(path.join(folder, rel))
      const target = path.join(out, 'prefabs', entry.name, ...rel.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes)
      files[rel] = { integrity: sri(bytes), size: bytes.length }
    }
    catalog.push({ name: entry.name, data: fs.readFileSync(path.join(folder, 'data.json'), 'utf8'), files })
  }
  const bytes = Buffer.from(JSON.stringify(catalog))
  fs.writeFileSync(path.join(out, 'prefabs', 'catalog.json'), bytes)
  return { file: 'prefabs/catalog.json', integrity: sri(bytes) }
}
