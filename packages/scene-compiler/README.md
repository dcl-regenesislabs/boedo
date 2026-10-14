# @dcl-editor/scene-compiler

Builds an SDK7 scene in the browser — no Node, no `npm install` — and writes the
result where the page's service worker serves a preview realm from.

- **Same output as `sdk-commands build`.** Same esbuild version (0.18.20, as wasm),
  options, defines and generated entry point as the `@dcl/sdk-commands` the scene
  templates pin; `main.crdt` comes from the same `@dcl/inspector` call.
- **The SDK comes from a snapshot** of that pinned `@dcl/sdk` and everything it
  imports (`dist/sdk-snapshot.json`). Those packages never come from npm.
- **Other packages come from npm, frozen into the project.** `resolveDependencies`
  downloads them once into a package store and writes `dcl-editor.lock.json`; a
  build reads only the store and the lock, so it never touches the network.
  `@dcl/asset-packs` comes from npm, a `file:` dependency or the project's own
  `node_modules`, else from a no-op stand-in.

## Build it

```bash
npm run build -w @dcl-editor/scene-compiler      # writes dist/ (gitignored)
npm run validate -w @dcl-editor/scene-compiler   # builds the starter template in headless Chromium, compares with sdk-commands
```

`validate` ends by installing two packages from registry.npmjs.org in the browser
and building again with the network off; `SKIP_LIVE_REGISTRY=1` leaves that out.

| File in `dist/` | What |
|---|---|
| `index.js` | The page library (ESM, self-contained). |
| `worker.js` | The build worker (classic worker script). |
| `esbuild.wasm` | The bundler. Serve as `application/wasm`. |
| `sdk-snapshot.json` | The SDK packages. Serve compressed. |

Serve the four files from the page's origin. A TypeScript consumer in this repo
imports `@dcl-editor/scene-compiler` (the sources); a plain page imports `dist/index.js`.

## Use it

```ts
import { createSceneBuilder, previewRealmUrl, publishPreview, reloadCommand } from '@dcl-editor/scene-compiler'

const builder = createSceneBuilder({
  workerUrl: new URL('scene-compiler/worker.js', pageDir),
  wasmUrl: new URL('scene-compiler/esbuild.wasm', pageDir),
  snapshotUrl: new URL('scene-compiler/sdk-snapshot.json', pageDir),
  onEvent: (event) => {} // buildStarted | diagnostics | bundleSaved | failed
})

// files: Map<string, Uint8Array> of the whole project, keyed by project-relative path
const build = await builder.build(files, { production: false })
if (build.ok) {
  const { entityId } = await publishPreview({
    realmUrl: previewRealmUrl(pageDir, projectId),
    projectId,
    files,
    buildOutputs: build.outputs, // bin/index.js, and main.crdt when the project has a composite
    sceneJson,
    machineId // optional, [A-Za-z0-9_.]: makes the entity id unique per creator
  })
  window.engine_console_command(reloadCommand(entityId))
}
```

## Packages

```ts
import { LOCK_FILE, MemoryPackageStore, parseLock, resolveDependencies, serializeLock } from '@dcl-editor/scene-compiler'

const { snapshot } = await builder.ready // what the SDK snapshot provides
const { lock, warnings } = await resolveDependencies({
  dependencies: packageJson.dependencies, // `file:` entries are left to the build
  devDependencies: packageJson.devDependencies, // only checked against the snapshot
  lock: parseLock(files.get(LOCK_FILE)), // what it pins is kept while it still fits
  store, // a PackageStore: MemoryPackageStore here, one over OPFS in the editor
  snapshot
})
files.set(LOCK_FILE, new TextEncoder().encode(serializeLock(lock)))
await builder.setPackages(lock, store) // every later build resolves imports from these
```

- Versions are picked as npm does (`latest` when it fits the range, else the
  highest that does); required peers are installed; one copy is shared where
  ranges allow, and a conflicting range gets its own copy under its dependent.
- Every tarball is checked against its sha512 before it is unpacked. Tarballs
  come only from the registry's origin. Nothing a package ships is run:
  install scripts, native bindings and Node built-ins are reported as warnings.
- With a lock that fits and a store that holds it, no request is made.
  `frozen: true` turns any request into an error.
- Limits: 200 packages, 100 MB unpacked, 20 MB per tarball (`limits`).
- A `PackageStore` is `has / list / read / write / remove`, keyed by
  `<name>@<version>`. A package counts as stored once its `.dcl-package.json`
  receipt is written, which happens last.
- Not supported: git, url and `workspace:` dependencies (reported and left out);
  `devDependencies` are not installed.
- A build that imports a package that is not installed fails with a diagnostic
  carrying `missingPackage`.

`dcl-editor.lock.json`:

```json
{
  "lockfileVersion": 1,
  "registry": "https://registry.npmjs.org",
  "dependencies": { "color": "4.2.3" },
  "packages": {
    "color@4.2.3": {
      "resolved": "https://registry.npmjs.org/color/-/color-4.2.3.tgz",
      "integrity": "sha512-…",
      "dependencies": { "color-convert": "2.0.1", "color-string": "1.9.1" }
    }
  }
}
```

`publishPreview` writes into Cache Storage `dcl-editor-preview-v1`:
`<realm>__manifest` (`{ version, entity }`) and one `<realm>content/contents/<hash>`
entry per deployable file. Ids are `b64-` ids the engine reads as a local scene.

## Not done here

Type-checking (the editor's TypeScript service does it), and the edits
`sdk-commands build` makes to `scene.json` / `package.json` as a side effect.
