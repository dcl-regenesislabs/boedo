// Reads tsconfig.json (following `extends`) for the bundler, which has no
// file system here: emit options go in as tsconfigRaw, paths to the resolver.
import type { TsconfigPaths } from './resolver'
import { type Vfs, dirname, isRecord, join } from './vfs'

export interface LoadedTsconfig {
  compilerOptions: Record<string, unknown>
  paths: TsconfigPaths | undefined
}

// the compiler options that change the emitted JavaScript
const EMIT_OPTIONS = [
  'alwaysStrict',
  'strict',
  'jsx',
  'jsxFactory',
  'jsxFragmentFactory',
  'jsxImportSource',
  'experimentalDecorators',
  'useDefineForClassFields',
  'target',
  'importsNotUsedAsValues',
  'preserveValueImports',
  'verbatimModuleSyntax'
]

// tsconfig files are JSON with comments and trailing commas
function parseJsonc(text: string): unknown {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      out += text.slice(start, i + 1)
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i === -1) break
      i++
    } else {
      out += char
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function locateExtended(vfs: Vfs, fromDir: string, specifier: string): string | undefined {
  const candidates = (base: string): string[] => [base, base + '.json', base + '/tsconfig.json']
  if (/^\.{0,2}\//.test(specifier)) return candidates(join(fromDir, specifier)).find((path) => vfs.has(path))
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const found = candidates(join(dir, 'node_modules/' + specifier)).find((path) => vfs.has(path))
    if (found !== undefined || dir === '/') return found
  }
}

export function loadTsconfig(vfs: Vfs, file: string, seen = new Set<string>()): LoadedTsconfig {
  const text = vfs.text(file)
  if (text === undefined || seen.has(file)) return { compilerOptions: {}, paths: undefined }
  seen.add(file)
  const json = parseJsonc(text)
  const dir = dirname(file)
  let merged: LoadedTsconfig = { compilerOptions: {}, paths: undefined }
  if (isRecord(json)) {
    const parents = typeof json.extends === 'string' ? [json.extends] : Array.isArray(json.extends) ? json.extends : []
    for (const parent of parents) {
      const parentFile = typeof parent === 'string' ? locateExtended(vfs, dir, parent) : undefined
      if (parentFile === undefined) continue
      const loaded = loadTsconfig(vfs, parentFile, seen)
      merged = {
        compilerOptions: { ...merged.compilerOptions, ...loaded.compilerOptions },
        paths: loaded.paths ?? merged.paths
      }
    }
    const own = isRecord(json.compilerOptions) ? json.compilerOptions : {}
    merged.compilerOptions = { ...merged.compilerOptions, ...own }
    const baseUrl = typeof own.baseUrl === 'string' ? join(dir, own.baseUrl) : merged.paths?.baseUrl
    if (isRecord(own.paths)) {
      const paths: Record<string, string[]> = {}
      for (const [pattern, targets] of Object.entries(own.paths)) {
        if (Array.isArray(targets)) paths[pattern] = targets.filter((t): t is string => typeof t === 'string')
      }
      merged.paths = { baseUrl, paths, pathsBase: baseUrl ?? dir }
    } else if (baseUrl !== undefined) {
      merged.paths = { baseUrl, paths: merged.paths?.paths, pathsBase: merged.paths?.paths ? merged.paths.pathsBase : baseUrl }
    }
  }
  return merged
}

export function emitOptions(compilerOptions: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of EMIT_OPTIONS) if (compilerOptions[key] !== undefined) out[key] = compilerOptions[key]
  return out
}
