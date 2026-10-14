// Which of a project's package.json dependencies the editor cannot build with
// yet: everything the SDK snapshot does not carry.
import { parseSceneJson } from '../shell/scene-json'

// the packages inside scene-compiler's sdk-snapshot.json (scripts/make-sdk-snapshot.mjs)
const BUNDLED = new Set([
  '@dcl/sdk',
  '@dcl/ecs',
  '@dcl/ecs-math',
  '@dcl/js-runtime',
  '@dcl/react-ecs',
  '@dcl/asset-packs',
  'react',
  'react-reconciler',
  'scheduler',
  'protobufjs',
  'long',
  'text-encoding'
])
// tools a desktop project runs, which no scene code imports
const TOOLING = /^(@dcl\/sdk-commands|typescript|eslint|prettier)$|^@types\/|^eslint-|^@typescript-eslint\//

// name -> the version range package.json asks for
export function externalDependencies(packageJson: Uint8Array | undefined): Record<string, string> {
  const manifest = parseSceneJson(packageJson)
  const needed: Record<string, string> = {}
  for (const section of [manifest?.dependencies, manifest?.devDependencies]) {
    if (typeof section !== 'object' || section === null) continue
    for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
      if (typeof range === 'string' && !BUNDLED.has(name) && !TOOLING.test(name)) needed[name] = range
    }
  }
  return needed
}
