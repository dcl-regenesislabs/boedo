import type { SdkSnapshot } from '../src/snapshot'

export interface PinnedSdk {
  version: string
  sdkDir: string
  sdkCommandsDir: string
  inspectorDir: string
  ecsDir: string
  reactFile: string
  esbuildVersion: string
  inspectorVersion: string
}

export function locatePinnedSdk(repoRoot?: string): PinnedSdk

export function buildSnapshot(repoRoot?: string): Promise<{
  snapshot: SdkSnapshot
  packages: { name: string; version: string; files: number; bytes: number }[]
  unresolved: string[]
}>

export function installChain(
  realFile: string,
  p?: { sep: string }
): { dirs: string[]; inner: string }
