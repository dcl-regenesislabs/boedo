// Where unpacked packages live. A package is only trusted once its receipt is written,
// which happens after every file: a half-written one is downloaded again.
import { isRecord } from '../vfs'

type MaybePromise<T> = T | Promise<T>

// pkgKey is "<name>@<version>"; paths are relative to the package folder, "/"-separated
export interface PackageStore {
  has(pkgKey: string): MaybePromise<boolean>
  list(pkgKey: string): MaybePromise<string[]>
  read(pkgKey: string, path: string): MaybePromise<Uint8Array | undefined>
  write(pkgKey: string, path: string, bytes: Uint8Array): MaybePromise<void>
  // drops every file of the package; called before one is unpacked again
  remove(pkgKey: string): MaybePromise<void>
}

export const PACKAGE_RECEIPT = '.dcl-package.json'

export interface PackageReceipt {
  // of the tarball the files came from
  integrity: string
  files: number
  bytes: number
  // lifecycle scripts the package declares; they are never run
  installScripts: string[]
  native: boolean
  // Node built-ins its entry module reaches
  nodeBuiltins: string[]
}

export class MemoryPackageStore implements PackageStore {
  private readonly packages = new Map<string, Map<string, Uint8Array>>()

  has(pkgKey: string): boolean {
    return this.packages.has(pkgKey)
  }

  list(pkgKey: string): string[] {
    return [...(this.packages.get(pkgKey)?.keys() ?? [])]
  }

  read(pkgKey: string, path: string): Uint8Array | undefined {
    return this.packages.get(pkgKey)?.get(path)
  }

  write(pkgKey: string, path: string, bytes: Uint8Array): void {
    let files = this.packages.get(pkgKey)
    if (files === undefined) this.packages.set(pkgKey, (files = new Map()))
    files.set(path, bytes)
  }

  remove(pkgKey: string): void {
    this.packages.delete(pkgKey)
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

export async function readReceipt(store: PackageStore, pkgKey: string): Promise<PackageReceipt | undefined> {
  if (!(await store.has(pkgKey))) return undefined
  const bytes = await store.read(pkgKey, PACKAGE_RECEIPT)
  if (bytes === undefined) return undefined
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!isRecord(json) || typeof json.integrity !== 'string') return undefined
    return {
      integrity: json.integrity,
      files: Number(json.files) || 0,
      bytes: Number(json.bytes) || 0,
      installScripts: strings(json.installScripts),
      native: json.native === true,
      nodeBuiltins: strings(json.nodeBuiltins)
    }
  } catch {
    return undefined
  }
}

export const writeReceipt = async (store: PackageStore, pkgKey: string, receipt: PackageReceipt): Promise<void> =>
  store.write(pkgKey, PACKAGE_RECEIPT, new TextEncoder().encode(JSON.stringify(receipt)))
