// Lays a project over the SDK snapshot, with the aliases sdk-commands gives the bundler.
import type { ProjectFiles } from './build-events'
import type { MountedPackages } from './packages/mount'
import { Resolver } from './resolver'
import type { SdkSnapshot } from './snapshot'
import { type LoadedTsconfig, loadTsconfig } from './tsconfig'
import { PROJECT_ROOT, Vfs, isRecord, join } from './vfs'

export interface MountedProject {
  vfs: Vfs
  resolver: Resolver
  tsconfig: LoadedTsconfig
  // the project's package.json dependencies and devDependencies
  dependencies: Record<string, unknown>
  // false when the build falls back to the snapshot's no-op @dcl/asset-packs
  ownAssetPacks: boolean
}

const ASSET_PACKS = '@dcl/asset-packs'

export function readProjectJson(files: ProjectFiles, path: string): Record<string, unknown> | undefined {
  const bytes = files.get(path)
  if (bytes === undefined) return undefined
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isRecord(json) ? json : undefined
  } catch {
    return undefined
  }
}

const topLevelPackage = (path: string): string | undefined => /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1]

export function assetPacksStubUpgrades(files: ProjectFiles): Map<string, Uint8Array> {
  const additions = new Map<string, Uint8Array>()
  const project = readProjectJson(files, 'package.json')
  const spec = isRecord(project?.dependencies) ? project.dependencies[ASSET_PACKS] : undefined
  if (typeof spec !== 'string' || !spec.startsWith('file:')) return additions
  const absolute = join(PROJECT_ROOT, spec.slice('file:'.length))
  if (!absolute.startsWith(`${PROJECT_ROOT}/`)) return additions
  const dir = absolute.slice(PROJECT_ROOT.length + 1)
  const stub = readProjectJson(files, `${dir}/package.json`)
  if (stub?.name !== ASSET_PACKS || stub.version !== '0.0.1-stub' || !files.has(`${dir}/dist/index.js`)) return additions
  const encoder = new TextEncoder()
  // Older editor starters expose the same event registry only at the package root.
  for (const [file, source] of Object.entries({
    'events.js': "'use strict'\nmodule.exports = require('./index')\n",
    'events.d.ts': "export { getActionEvents, getTriggerEvents } from './index'\n"
  })) {
    const path = `${dir}/dist/${file}`
    if (!files.has(path)) additions.set(path, encoder.encode(source))
  }
  return additions
}

export function mountProject(snapshot: SdkSnapshot, files: ProjectFiles, packages?: MountedPackages): MountedProject {
  const packageJson = readProjectJson(files, 'package.json') ?? {}
  const dependencies = {
    ...(isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {}),
    ...(isRecord(packageJson.dependencies) ? packageJson.dependencies : {})
  }
  // `file:` dependencies resolve where npm would have linked them
  const links: Record<string, string> = {}
  for (const [name, spec] of Object.entries(dependencies)) {
    if (typeof spec === 'string' && spec.startsWith('file:')) links[name] = join(PROJECT_ROOT, spec.slice('file:'.length))
  }
  const assetPacksDir = `node_modules/${ASSET_PACKS}/`
  const ownAssetPacks =
    links[ASSET_PACKS] !== undefined ||
    packages?.topLevel.has(ASSET_PACKS) === true ||
    [...files.keys()].some((path) => path.startsWith(assetPacksDir))

  const vfs = new Vfs()
  for (const [path, text] of Object.entries(snapshot.files)) {
    if (!(ownAssetPacks && path.startsWith(assetPacksDir))) vfs.set(join(PROJECT_ROOT, path), text)
  }
  // the snapshot wins a clash: neither a package nor the project can swap out the pinned SDK
  for (const [path, bytes] of packages?.files ?? []) {
    if (!vfs.has(path)) vfs.set(path, bytes)
  }
  for (const [path, bytes] of files) {
    const absolute = join(PROJECT_ROOT, path)
    const owner = packages === undefined ? undefined : topLevelPackage(path)
    // a frozen package is not mixed with a copy the project carries in its own node_modules
    if (!vfs.has(absolute) && !(owner !== undefined && packages?.topLevel.has(owner))) vfs.set(absolute, bytes)
  }
  for (const [path, bytes] of assetPacksStubUpgrades(files)) vfs.set(join(PROJECT_ROOT, path), bytes)

  const aliases: Record<string, string> = {}
  for (const [name, target] of Object.entries(snapshot.meta.aliases)) aliases[name] = join(PROJECT_ROOT, target)
  // the SDK's own packages sit inside it: a direct import of one still gets the pinned copy
  for (const [name, { dir }] of Object.entries(snapshot.meta.provided)) {
    if (dir !== null && dir !== 'node_modules/' + name && aliases[name] === undefined) aliases[name] = join(PROJECT_ROOT, dir)
  }
  aliases[ASSET_PACKS] = links[ASSET_PACKS] ?? aliases[ASSET_PACKS]
  const tsconfig = loadTsconfig(vfs, join(PROJECT_ROOT, 'tsconfig.json'))
  return {
    vfs,
    resolver: new Resolver({ vfs, aliases, links, linkRoot: PROJECT_ROOT, tsconfig: tsconfig.paths }),
    tsconfig,
    dependencies,
    ownAssetPacks
  }
}
