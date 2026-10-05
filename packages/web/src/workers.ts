import type { SceneBuilderOptions } from '@dcl-editor/web-build'

// sha384 of every file the package fetches next to editor.js, written into this
// bundle at build time (scripts/build.mjs): editor.js's own integrity covers them
declare const __EDITOR_FILE_INTEGRITY__: Readonly<Record<string, string>>

export type WebBuildFiles = Pick<SceneBuilderOptions, 'workerUrl' | 'wasmUrl' | 'snapshotUrl' | 'integrity'>

export function fileIntegrity(file: string): string {
  const integrity = __EDITOR_FILE_INTEGRITY__[file]
  if (integrity === undefined) throw new Error(`${file} is not one of the editor's published files`)
  return integrity
}

export function webBuildFiles(editorBase: string): WebBuildFiles {
  const at = (file: string): string => new URL(`web-build/${file}`, editorBase).href
  return {
    workerUrl: at('worker.js'),
    wasmUrl: at('esbuild.wasm'),
    snapshotUrl: at('sdk-snapshot.json'),
    integrity: {
      worker: fileIntegrity('web-build/worker.js'),
      wasm: fileIntegrity('web-build/esbuild.wasm'),
      snapshot: fileIntegrity('web-build/sdk-snapshot.json')
    }
  }
}
