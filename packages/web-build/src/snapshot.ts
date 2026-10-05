// The file scripts/make-sdk-snapshot.mjs writes.
export interface SdkSnapshot {
  meta: {
    sdkVersion: string
    sdkCommandsVersion: string
    inspectorVersion: string
    esbuildVersion: string
    // package name -> snapshot path that replaces it in every import
    aliases: Record<string, string>
    // packages a scene gets from here and never from npm: name -> its version, and its snapshot folder when it has files
    provided: Record<string, { version: string; dir: string | null }>
    placeholders: { entrypoint: string; scriptImports: string; scriptsArray: string }
    entrypoint: { scene: string; editorScene: string }
    scriptUtils: string
  }
  // path under the project root ("node_modules/...") -> file text
  files: Record<string, string>
}
