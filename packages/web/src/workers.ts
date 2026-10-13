import { fetchVerified, type SceneBuilderOptions } from '@dcl-editor/web-build'

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

// The three.js worker's source (model builds, the 3D preview), verified once.
export function threeWorkerSource(editorBase: string): () => Promise<string> {
  let text: Promise<string> | null = null
  return async () => {
    text ??= fetchVerified(new URL('three/worker.js', editorBase).href, fileIntegrity('three/worker.js'), 'three/worker.js').then((response) => response.text())
    text.catch(() => { text = null })
    return await text
  }
}
