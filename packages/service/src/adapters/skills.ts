import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { object } from '../../../contract/src/assistant.ts'

const PAGE_SIZE = 16_000

export interface SkillsComponent {
  catalog: string
  read(path: string, offset?: number, query?: string): string
}

export async function createSkillsComponent(): Promise<SkillsComponent> {
  const bundle: unknown = JSON.parse(await readFile(new URL('../../skills/sdk-skills.json', import.meta.url), 'utf8'))
  if (!object(bundle) || !object(bundle.files) || !Array.isArray(bundle.catalog)) throw new Error('Invalid SDK skills bundle')
  const files = new Map<string, string>()
  for (const [path, content] of Object.entries(bundle.files)) {
    if (typeof content !== 'string') throw new Error('Invalid SDK skill document')
    files.set(path, content)
  }
  const catalog = bundle.catalog.map((skill: unknown) => {
    if (!object(skill) || typeof skill.name !== 'string' || typeof skill.description !== 'string' || !files.has(`${skill.name}/SKILL.md`)) {
      throw new Error('Invalid SDK skill catalog')
    }
    return `- ${skill.name}/SKILL.md: ${skill.description}`
  }).join('\n')
  return {
    catalog,
    read(path, offset = 0, query) {
      // Lookups use only this packaged map; model-supplied paths never reach the filesystem.
      if (path.length > 512 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) throw new Error('Unknown SDK skill document')
      const key = posix.normalize(path)
      const source = files.get(key)
      if (source === undefined) throw new Error('Unknown SDK skill document')
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid skill offset')
      const baseDir = key.split('/')[0]
      const content = source.replaceAll('{baseDir}', baseDir)
      if (query !== undefined) {
        if (query.trim() === '' || query.length > 128) throw new Error('Invalid skill search')
        const matches: Array<{ offset: number; text: string }> = []
        let cursor = 0
        let total = 0
        for (const line of content.split('\n')) {
          if (cursor >= offset && line.toLowerCase().includes(query.toLowerCase())) {
            total++
            if (matches.length < 20) matches.push({ offset: cursor, text: line.slice(0, 640) })
          }
          cursor += line.length + 1
        }
        return JSON.stringify({ path: key, matches, total })
      }
      const end = Math.min(offset + PAGE_SIZE, content.length)
      return JSON.stringify({
        path: key, baseDir, offset, content: content.slice(offset, end),
        nextOffset: end < content.length ? end : null,
        ...(key.endsWith('/SKILL.md') ? { references: [...files.keys()].filter((file) => file.startsWith(`${baseDir}/`) && file !== key) } : {})
      })
    }
  }
}
