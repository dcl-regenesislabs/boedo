// What a freshly unpacked package would need that a scene build never gives it.
import { Resolver } from '../resolver'
import { Vfs, dirname, isRecord } from '../vfs'
import { isNodeBuiltin } from './node-builtins'

const SPECIFIER =
  /(?<![.\w$])require\(\s*['"]([^'"\n]+)['"]\s*\)|\b(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(?\s*['"]([^'"\n]+)['"]/g
const SCRIPT = /\.(js|mjs|cjs|json)$/
const MAX_MODULES = 2000
const MAX_MODULE_BYTES = 1024 * 1024

export interface PackageTraits {
  installScripts: string[]
  native: boolean
  nodeBuiltins: string[]
}

function manifestOf(files: ReadonlyMap<string, Uint8Array>): Record<string, unknown> {
  const bytes = files.get('package.json')
  if (bytes === undefined) return {}
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isRecord(json) ? json : {}
  } catch {
    return {}
  }
}

// Node built-ins reached from the module `import '<name>'` loads, following the package's own files
function nodeBuiltinsOf(name: string, files: ReadonlyMap<string, Uint8Array>): string[] {
  const vfs = new Vfs()
  const root = '/node_modules/' + name
  for (const [path, bytes] of files) {
    if (SCRIPT.test(path) && bytes.length <= MAX_MODULE_BYTES) vfs.set(`${root}/${path}`, bytes)
  }
  const resolver = new Resolver({ vfs })
  const entry = resolver.resolve(name, '/', 'import')
  const found = new Set<string>()
  const seen = new Set<string>()
  const pending = entry.kind === 'file' ? [entry.path] : []
  for (let file = pending.pop(); file !== undefined && seen.size < MAX_MODULES; file = pending.pop()) {
    if (seen.has(file) || file.endsWith('.json')) continue
    seen.add(file)
    for (const match of (vfs.text(file) ?? '').matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      const target = resolver.resolve(specifier, dirname(file), match[1] === undefined ? 'import' : 'require')
      if (target.kind === 'file') pending.push(target.path)
      else if (target.kind === 'missing' && isNodeBuiltin(specifier)) found.add(specifier.replace(/^node:/, '').split('/', 1)[0])
    }
  }
  return [...found].sort()
}

export function inspectPackage(name: string, files: ReadonlyMap<string, Uint8Array>): PackageTraits {
  const manifest = manifestOf(files)
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {}
  const gyp = files.has('binding.gyp') || manifest.gypfile === true
  const installScripts = ['preinstall', 'install', 'postinstall'].filter((script) => typeof scripts[script] === 'string')
  // npm runs node-gyp for a binding.gyp even with no script declared
  if (gyp && !installScripts.includes('install')) installScripts.push('install')
  return {
    installScripts,
    native: gyp || [...files.keys()].some((path) => path.endsWith('.node')),
    nodeBuiltins: nodeBuiltinsOf(name, files)
  }
}
