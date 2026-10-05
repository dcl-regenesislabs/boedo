// A scene build with the options and entry point of sdk-commands' logic/bundle.ts;
// a plugin serves every module out of the in-memory file system.
import type * as Esbuild from 'esbuild-wasm'
import type { BuildDiagnostic, BuildOptions, ProjectFiles } from './build-events'
import { type ScriptInstance, isEditorScene, readComposites } from './composite'
import type { MountedPackages } from './packages/mount'
import { isNodeBuiltin } from './packages/node-builtins'
import { mountProject, readProjectJson } from './project-vfs'
import { type Resolver, isPackagePath, packageNameOf } from './resolver'
import type { SdkSnapshot } from './snapshot'
import { emitOptions } from './tsconfig'
import { PROJECT_ROOT, type Vfs, dirname, extname, isRecord, join } from './vfs'

export interface SceneBuildOutcome {
  outputs: Map<string, Uint8Array>
  // project-relative path of the bundle inside `outputs`
  bundleFile: string | undefined
  diagnostics: BuildDiagnostic[]
  failure: string | undefined
}

type EsbuildApi = Pick<typeof Esbuild, 'context'>

const ENTRY = 'src/index.ts'
const LOADERS: Record<string, Esbuild.Loader> = {
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.json': 'json',
  '.css': 'css',
  '.txt': 'text'
}
const EXTERNAL = /^~system\/|^@dcl\/inspector(\/|$)/

const fail = (message: string): SceneBuildOutcome => ({
  outputs: new Map(),
  bundleFile: undefined,
  diagnostics: [{ severity: 'error', message }],
  failure: message
})

// "src/scripts/my-script.ts" -> "script_src_scripts_my_script"
const scriptImportName = (path: string): string => 'script_' + path.replace(/\.tsx?$/, '').replace(/[^a-zA-Z0-9]/g, '_')

function scriptUtilsModule(snapshot: SdkSnapshot, scripts: Map<string, ScriptInstance[]>): string {
  const imports: string[] = []
  const entries: string[] = []
  for (const [path, instances] of scripts) {
    const name = scriptImportName(path)
    imports.push(`import * as ${name} from ${JSON.stringify('./' + path)}`)
    for (const instance of instances) entries.push(`  { ...${JSON.stringify(instance)}, module: ${name} }`)
  }
  const { placeholders, scriptUtils } = snapshot.meta
  return scriptUtils
    .replace(placeholders.scriptImports, () => imports.join('\n'))
    .replace(placeholders.scriptsArray, () => (scripts.size === 0 ? '[]' : `[\n${entries.join(',\n')}\n]`))
}

function toDiagnostics(messages: Esbuild.Message[], severity: BuildDiagnostic['severity']): BuildDiagnostic[] {
  return messages.map((m) => ({
    severity,
    message: m.text,
    file: m.location?.file,
    line: m.location?.line,
    column: m.location?.column,
    lineText: m.location?.lineText,
    ...(isRecord(m.detail) && typeof m.detail.missingPackage === 'string' ? { missingPackage: m.detail.missingPackage } : {})
  }))
}

const isBuildFailure = (err: unknown): err is Esbuild.BuildFailure =>
  err instanceof Error && 'errors' in err && Array.isArray(err.errors)

// says why a package import found nothing, which the bundler alone cannot know
function unresolved(specifier: string, importer: string, vfs: Vfs): Esbuild.PartialMessage {
  const text = `Could not resolve "${specifier}"`
  if (!isPackagePath(specifier) || specifier.startsWith('#')) return { text }
  const cut = importer.lastIndexOf('/node_modules/')
  const from = cut === -1 ? '' : ` (imported by ${packageNameOf(importer.slice(cut + '/node_modules/'.length))})`
  if (isNodeBuiltin(specifier)) return { text: `${text}: it is a Node built-in, which a scene does not have${from}` }
  const name = packageNameOf(specifier)
  if (vfs.isDir(join(PROJECT_ROOT, 'node_modules/' + name))) return { text: `${text}: the package "${name}" has no module there${from}` }
  return { text: `${text}: the package "${name}" is not installed${from}`, detail: { missingPackage: name } }
}

interface Inputs {
  vfs: Vfs
  resolver: Resolver
  virtualModules: Record<string, string>
}

export class SceneBuildSession {
  private context: Esbuild.BuildContext | undefined
  private contextKey = ''
  // what the plugin of the live context reads; swapped on every build
  private inputs: Inputs | undefined
  private packages: MountedPackages | undefined

  constructor(
    private readonly esbuild: EsbuildApi,
    private readonly snapshot: SdkSnapshot
  ) {}

  // the frozen packages later builds resolve imports from
  setPackages(packages: MountedPackages | undefined): void {
    this.packages = packages
  }

  async build(files: ProjectFiles, options: BuildOptions): Promise<SceneBuildOutcome> {
    const production = options.production === true
    const sceneJson = readProjectJson(files, 'scene.json')
    if (sceneJson === undefined) return fail('scene.json is missing or is not valid JSON')
    const main = sceneJson.main
    if (typeof main !== 'string' || main === '') return fail('scene.json needs a "main" entry, the path of the built bundle')
    if (sceneJson.runtimeVersion !== '7') return fail('scene.json needs "runtimeVersion": "7"')
    if (!files.has('tsconfig.json')) return fail('tsconfig.json is missing')
    if (!files.has(ENTRY)) return fail(`${ENTRY} is missing`)

    const diagnostics: BuildDiagnostic[] = []
    const { meta } = this.snapshot
    const project = mountProject(this.snapshot, files, this.packages)
    const pinnedSdk = project.dependencies['@dcl/sdk']
    if (typeof pinnedSdk === 'string' && /^\d/.test(pinnedSdk) && pinnedSdk !== meta.sdkVersion) {
      diagnostics.push({
        severity: 'warning',
        file: 'package.json',
        message: `This project pins @dcl/sdk ${pinnedSdk}; it is built here with ${meta.sdkVersion}.`
      })
    }

    const composites = readComposites(files)
    diagnostics.push(...composites.diagnostics)
    const editorScene = isEditorScene(files)
    if (editorScene && !project.ownAssetPacks) {
      diagnostics.push({
        severity: 'warning',
        message: 'This scene uses smart items but ships no @dcl/asset-packs; they are built as no-ops.'
      })
    }

    this.inputs = {
      vfs: project.vfs,
      resolver: project.resolver,
      virtualModules: {
        'sdk-composite': `export const compositeFromLoader = {${composites.compositeLines.join(',')}}`,
        'sdk-scripts': scriptUtilsModule(this.snapshot, composites.scripts)
      }
    }

    const buildOptions: Esbuild.BuildOptions = {
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      write: false,
      outfile: join(PROJECT_ROOT, main),
      sourcemap: production ? false : 'inline',
      minify: production,
      minifyIdentifiers: production,
      minifySyntax: production,
      minifyWhitespace: production,
      treeShaking: true,
      absWorkingDir: PROJECT_ROOT,
      target: 'es2020',
      sourceRoot: 'dcl://' + (production ? '/' : dirname('/' + main)),
      define: {
        document: 'undefined',
        window: 'undefined',
        DEBUG: production ? 'false' : 'true',
        'globalThis.DEBUG': production ? 'false' : 'true',
        'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
        DCL_MAX_COMPOSITE_ENTITY: String(composites.maxCompositeEntity)
      },
      tsconfigRaw: JSON.stringify({ compilerOptions: emitOptions(project.tsconfig.compilerOptions) }),
      supported: { 'import-assertions': false, 'import-meta': false, 'dynamic-import': false, hashbang: false },
      logOverride: { 'import-is-undefined': 'silent' },
      logLevel: 'silent',
      stdin: {
        contents: (editorScene ? meta.entrypoint.editorScene : meta.entrypoint.scene)
          .split(JSON.stringify(meta.placeholders.entrypoint))
          .join(JSON.stringify(join(PROJECT_ROOT, ENTRY))),
        resolveDir: join(PROJECT_ROOT, dirname(ENTRY)),
        sourcefile: 'index.ts.entry-point.ts',
        loader: 'ts'
      }
    }

    try {
      const context = await this.contextFor(buildOptions)
      const result = await context.rebuild()
      diagnostics.push(...toDiagnostics(result.warnings, 'warning'))
      const bundle = result.outputFiles?.[0]
      if (bundle === undefined) return { outputs: new Map(), bundleFile: undefined, diagnostics, failure: 'The bundler produced no output' }
      const outputs = new Map<string, Uint8Array>([[main, bundle.contents]])
      if (composites.crdt !== undefined) outputs.set('main.crdt', composites.crdt)
      return { outputs, bundleFile: main, diagnostics, failure: undefined }
    } catch (err) {
      if (!isBuildFailure(err)) throw err
      diagnostics.push(...toDiagnostics(err.errors, 'error'), ...toDiagnostics(err.warnings, 'warning'))
      return { outputs: new Map(), bundleFile: undefined, diagnostics, failure: err.message }
    }
  }

  // reused while the options hold: it keeps the parse cache between rebuilds
  private async contextFor(options: Esbuild.BuildOptions): Promise<Esbuild.BuildContext> {
    const key = JSON.stringify(options)
    if (this.context !== undefined && key === this.contextKey) return this.context
    await this.context?.dispose()
    this.context = await this.esbuild.context({ ...options, plugins: [this.plugin()] })
    this.contextKey = key
    return this.context
  }

  private plugin(): Esbuild.Plugin {
    const current = (): Inputs => {
      if (this.inputs === undefined) throw new Error('no build in progress')
      return this.inputs
    }
    return {
      name: 'in-memory-scene',
      setup: (build) => {
        build.onResolve({ filter: /~sdk\/all-composites/ }, () => ({ namespace: 'sdk-composite', path: 'all-composites' }))
        build.onResolve({ filter: /~sdk\/script-utils/ }, () => ({ namespace: 'sdk-scripts', path: 'script-utils' }))
        build.onLoad({ filter: /.*/, namespace: 'sdk-composite' }, () => ({
          loader: 'js',
          contents: current().virtualModules['sdk-composite']
        }))
        build.onLoad({ filter: /.*/, namespace: 'sdk-scripts' }, () => ({
          loader: 'js',
          contents: current().virtualModules['sdk-scripts'],
          resolveDir: PROJECT_ROOT
        }))
        build.onResolve({ filter: /.*/ }, (args) => {
          if (EXTERNAL.test(args.path)) return { path: args.path, external: true }
          const kind = args.kind === 'require-call' || args.kind === 'require-resolve' ? 'require' : 'import'
          const found = current().resolver.resolve(args.path, args.resolveDir || PROJECT_ROOT, kind)
          if (found.kind === 'file') return { path: found.path, sideEffects: found.sideEffects }
          if (found.kind === 'disabled') return { path: found.path, namespace: 'disabled' }
          return { errors: [unresolved(args.path, args.importer, current().vfs)] }
        })
        build.onLoad({ filter: /.*/, namespace: 'disabled' }, () => ({ loader: 'js', contents: '' }))
        build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
          const contents = current().vfs.read(args.path)
          const loader = LOADERS[extname(args.path)]
          if (contents === undefined) return { errors: [{ text: `File not found: ${args.path}` }] }
          if (loader === undefined) return { errors: [{ text: `No loader is configured for "${extname(args.path)}" files: ${args.path}` }] }
          return { contents, loader }
        })
      }
    }
  }
}
