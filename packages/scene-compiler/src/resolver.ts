// Module resolution over the in-memory file system, by the rules the native
// bundler applies for `platform: 'browser'`, so the same files get bundled.
import { type Vfs, dirname, extname, isRecord, join, normalize } from './vfs'

export type ImportKind = 'import' | 'require'

export type Resolution =
  | { kind: 'file'; path: string; sideEffects: boolean }
  // mapped to `false` by a `browser` field: bundles as an empty module
  | { kind: 'disabled'; path: string }
  | { kind: 'missing' }

export interface TsconfigPaths {
  baseUrl?: string
  paths?: Record<string, string[]>
  // directory `paths` substitutions are relative to
  pathsBase: string
}

export interface ResolverConfig {
  vfs: Vfs
  // package name -> absolute file or directory that replaces it everywhere
  aliases?: Record<string, string>
  // `file:` dependencies, as if linked into <linkRoot>/node_modules
  links?: Record<string, string>
  linkRoot?: string
  tsconfig?: TsconfigPaths
}

interface PackageInfo {
  dir: string
  json: Record<string, unknown>
}

type Hit = { path: string; disabled?: true } | undefined

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json']
// inside node_modules a published .js wins over a stray .ts next to it
const PACKAGE_EXTENSIONS = ['.jsx', '.js', '.css', '.json', '.tsx', '.ts']
const TS_REWRITES: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.ts', '.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts']
}

export const isPackagePath = (specifier: string): boolean =>
  !/^\.{0,2}\//.test(specifier) && specifier !== '.' && specifier !== '..'

export const packageNameOf = (specifier: string): string =>
  specifier.split('/', specifier.startsWith('@') ? 2 : 1).join('/')

const inNodeModules = (path: string): boolean => (path + '/').includes('/node_modules/')

function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/^\.\//, '')
  const body = (pattern.includes('/') ? pattern : '**/' + pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/|\*\*|\*|\?/g, (token) =>
      token === '**/' ? '(?:.*/)?' : token === '**' ? '.*' : token === '*' ? '[^/]*' : '[^/]'
    )
  return new RegExp('^' + body + '$')
}

export class Resolver {
  private readonly packages = new Map<string, PackageInfo | null>()

  constructor(private readonly config: ResolverConfig) {}

  resolve(specifier: string, importerDir: string, kind: ImportKind): Resolution {
    const hit = this.locate(specifier, importerDir, kind)
    if (hit === undefined) return { kind: 'missing' }
    if (hit.disabled) return { kind: 'disabled', path: hit.path }
    return { kind: 'file', path: hit.path, sideEffects: this.hasSideEffects(hit.path) }
  }

  private locate(specifier: string, importerDir: string, kind: ImportKind): Hit {
    if (!isPackagePath(specifier)) {
      return this.loadPath(specifier.startsWith('/') ? normalize(specifier) : join(importerDir, specifier), kind)
    }
    for (const [name, target] of Object.entries(this.config.aliases ?? {})) {
      if (specifier === name || specifier.startsWith(name + '/')) {
        return this.loadPath(target + specifier.slice(name.length), kind)
      }
    }
    const importer = this.enclosingPackage(importerDir)
    if (specifier.startsWith('#')) return importer === null ? undefined : this.packageImports(importer, specifier, kind)
    if (importer !== null && isRecord(importer.json.browser)) {
      const mapped = importer.json.browser[specifier]
      if (mapped === false) return { path: specifier, disabled: true }
      if (typeof mapped === 'string') {
        return isPackagePath(mapped) ? this.loadPackage(mapped, importer.dir, kind) : this.loadPath(join(importer.dir, mapped), kind)
      }
    }
    const { tsconfig } = this.config
    if (tsconfig !== undefined && !inNodeModules(importerDir)) {
      const viaTsconfig = this.loadTsconfigPath(tsconfig, specifier, kind)
      if (viaTsconfig !== undefined) return viaTsconfig
    }
    return this.loadPackage(specifier, importerDir, kind)
  }

  private loadTsconfigPath(tsconfig: TsconfigPaths, specifier: string, kind: ImportKind): Hit {
    let best: { star: string; prefix: number; targets: string[] } | undefined
    for (const [pattern, targets] of Object.entries(tsconfig.paths ?? {})) {
      const star = pattern.indexOf('*')
      if (star === -1) {
        if (pattern === specifier) {
          best = { star: '', prefix: Infinity, targets }
          break
        }
        continue
      }
      const prefix = pattern.slice(0, star)
      const suffix = pattern.slice(star + 1)
      if (specifier.length < prefix.length + suffix.length) continue
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
      if (best === undefined || prefix.length > best.prefix) {
        best = { star: specifier.slice(prefix.length, specifier.length - suffix.length), prefix: prefix.length, targets }
      }
    }
    if (best !== undefined) {
      for (const target of best.targets) {
        const hit = this.loadPath(join(tsconfig.pathsBase, target.replace('*', best.star)), kind)
        if (hit !== undefined) return hit
      }
    }
    return tsconfig.baseUrl === undefined ? undefined : this.loadPath(join(tsconfig.baseUrl, specifier), kind)
  }

  private loadPackage(specifier: string, importerDir: string, kind: ImportKind): Hit {
    const name = packageNameOf(specifier)
    const subpath = specifier.slice(name.length)
    for (let dir = importerDir; ; dir = dirname(dir)) {
      if (!dir.endsWith('/node_modules')) {
        let packageDir = join(dir, 'node_modules/' + name)
        const link = this.config.links?.[name]
        if (!this.config.vfs.isDir(packageDir) && link !== undefined && dir === this.config.linkRoot) packageDir = link
        if (this.config.vfs.isDir(packageDir)) {
          const exportsField = this.packageAt(packageDir)?.json.exports
          if (exportsField !== undefined && exportsField !== null) {
            const target = this.matchExports(packageDir, exportsField, '.' + subpath, kind)
            return target === undefined ? undefined : this.applyBrowserMap(target, kind)
          }
          const hit = this.loadPath(packageDir + subpath, kind)
          if (hit !== undefined) return hit
        }
      }
      if (dir === '/') return undefined
    }
  }

  private packageImports(importer: PackageInfo, specifier: string, kind: ImportKind): Hit {
    const { imports } = importer.json
    if (!isRecord(imports)) return undefined
    const target = this.matchSubpath(imports, specifier, kind, (value) =>
      value.startsWith('./') ? this.loadPath(join(importer.dir, value), kind) : this.loadPackage(value, importer.dir, kind)
    )
    return target
  }

  private matchExports(packageDir: string, field: unknown, subpath: string, kind: ImportKind): string | undefined {
    const table =
      isRecord(field) && Object.keys(field).some((key) => key.startsWith('.')) ? field : { '.': field }
    const hit = this.matchSubpath(table, subpath, kind, (value) => {
      if (!value.startsWith('./')) return undefined
      const path = join(packageDir, value)
      return this.config.vfs.has(path) ? { path } : undefined
    })
    return hit?.path
  }

  private matchSubpath(
    table: Record<string, unknown>,
    subpath: string,
    kind: ImportKind,
    load: (target: string) => Hit
  ): Hit {
    const conditions = new Set(['browser', 'default', 'module', kind])
    const resolveTarget = (target: unknown, star: string | null): Hit | null => {
      if (typeof target === 'string') return load(star === null ? target : target.split('*').join(star))
      if (Array.isArray(target)) {
        for (const entry of target) {
          const hit = resolveTarget(entry, star)
          if (hit !== undefined) return hit
        }
        return undefined
      }
      if (isRecord(target)) {
        for (const [condition, value] of Object.entries(target)) {
          if (!conditions.has(condition)) continue
          const hit = resolveTarget(value, star)
          if (hit !== undefined) return hit
        }
        return undefined
      }
      return target === null ? null : undefined
    }
    if (Object.prototype.hasOwnProperty.call(table, subpath) && !subpath.includes('*')) {
      return resolveTarget(table[subpath], null) ?? undefined
    }
    let best: { key: string; star: string } | undefined
    for (const key of Object.keys(table)) {
      const starAt = key.indexOf('*')
      const prefix = starAt === -1 ? key : key.slice(0, starAt)
      const suffix = starAt === -1 ? '' : key.slice(starAt + 1)
      // a key ending in "/" is the legacy folder form of "<key>*"
      if (starAt === -1 && !key.endsWith('/')) continue
      if (subpath.length < prefix.length + suffix.length) continue
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
      if (best === undefined || key.length > best.key.length) {
        best = { key, star: subpath.slice(prefix.length, subpath.length - suffix.length) }
      }
    }
    if (best === undefined) return undefined
    const target = table[best.key]
    if (best.key.endsWith('/') && typeof target === 'string') return load(target + best.star)
    return resolveTarget(target, best.star) ?? undefined
  }

  private loadPath(path: string, kind: ImportKind): Hit {
    const file = this.loadAsFile(path) ?? this.loadAsDirectory(path, kind)
    return file === undefined ? undefined : this.applyBrowserMap(file, kind)
  }

  private applyBrowserMap(file: string, kind: ImportKind): Hit {
    const owner = this.enclosingPackage(dirname(file))
    if (owner === null || !isRecord(owner.json.browser)) return { path: file }
    const relative = './' + file.slice(owner.dir.length + 1)
    const bare = relative.replace(/\.(js|json)$/, '')
    for (const key of [relative, bare, relative.slice(2), bare.slice(2)]) {
      const mapped = owner.json.browser[key]
      if (mapped === false) return { path: file, disabled: true }
      if (typeof mapped === 'string') {
        const target = join(owner.dir, mapped)
        const replaced = this.loadAsFile(target) ?? this.loadAsDirectory(target, kind)
        return replaced === undefined ? undefined : { path: replaced }
      }
    }
    return { path: file }
  }

  private loadAsFile(path: string): string | undefined {
    const { vfs } = this.config
    if (vfs.has(path)) return path
    for (const ext of inNodeModules(path) ? PACKAGE_EXTENSIONS : SOURCE_EXTENSIONS) {
      if (vfs.has(path + ext)) return path + ext
    }
    const ext = extname(path)
    for (const rewrite of TS_REWRITES[ext] ?? []) {
      const candidate = path.slice(0, -ext.length) + rewrite
      if (vfs.has(candidate)) return candidate
    }
    return undefined
  }

  private loadAsIndex(dir: string): string | undefined {
    for (const ext of inNodeModules(dir) ? PACKAGE_EXTENSIONS : SOURCE_EXTENSIONS) {
      const candidate = dir + '/index' + ext
      if (this.config.vfs.has(candidate)) return candidate
    }
    return undefined
  }

  private loadAsDirectory(dir: string, kind: ImportKind): string | undefined {
    if (!this.config.vfs.isDir(dir)) return undefined
    const pkg = this.packageAt(dir)
    return (pkg === null ? undefined : this.loadMainField(pkg, kind)) ?? this.loadAsIndex(dir)
  }

  private loadMainField(pkg: PackageInfo, kind: ImportKind): string | undefined {
    const load = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined
      const target = join(pkg.dir, value)
      return this.loadAsFile(target) ?? this.loadAsIndex(target)
    }
    const browser = load(pkg.json.browser)
    if (browser !== undefined) return browser
    const esm = load(pkg.json.module)
    if (esm === undefined) return load(pkg.json.main)
    // with both entries published, `require` gets `main` and `import` gets `module`
    const main = pkg.json.main === undefined ? this.loadAsIndex(pkg.dir) : load(pkg.json.main)
    return kind === 'require' && main !== undefined ? main : esm
  }

  private packageAt(dir: string): PackageInfo | null {
    const cached = this.packages.get(dir)
    if (cached !== undefined) return cached
    const json = this.config.vfs.json(dir + '/package.json')
    const info = isRecord(json) ? { dir, json } : null
    this.packages.set(dir, info)
    return info
  }

  private enclosingPackage(dir: string): PackageInfo | null {
    for (let current = dir; ; current = dirname(current)) {
      const info = this.packageAt(current)
      if (info !== null) return info
      if (current === '/') return null
    }
  }

  private hasSideEffects(file: string): boolean {
    const owner = this.enclosingPackage(dirname(file))
    const declared = owner?.json.sideEffects
    if (owner === null || declared === undefined || declared === true) return true
    if (!Array.isArray(declared)) return declared !== false
    const relative = file.slice(owner.dir.length + 1)
    return declared.some((glob) => typeof glob === 'string' && globToRegExp(glob).test(relative))
  }
}
