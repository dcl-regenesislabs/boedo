# Mobile preview hosting

`@dcl-editor/mobile-preview` is the editor's private hosting and transport adapter.
It depends on an exact npm version of `@dcl-regenesislabs/mobile-preview-runtime`,
published by [test-godot-web](https://github.com/kuruk-mm/test-godot-web) using npm OIDC.
The editor never clones or builds Godot source and needs no source-access token.
bevy-explorer has no mobile runtime dependency or configuration.

After `npm ci`, prepare and serve the installed runtime:

```sh
npm run build -w @dcl-editor/mobile-preview
npm run serve -w @dcl-editor/mobile-preview
```

`npm run dev:web` prepares and starts this server automatically at
`http://127.0.0.1:8788/mobile-preview/`. The loopback IP differs from the editor's
`localhost` site to isolate startup. The service image installs the same pinned
package, verifies its size/SHA-256 manifest, adds the editor transport and serves
it at `/mobile-preview/`. Generated files stay out of Git and Docker's build context.

For local runtime development, pass an exported directory to the build command or
set `MOBILE_PREVIEW_EXPORT=/path/to/mobile/build/web` before `npm run dev:web`.
This explicit development override bypasses npm; normal installs and CI use npm.

To adopt the newest release while retaining an exact version and lockfile integrity:

```sh
npm install --save-exact @dcl-regenesislabs/mobile-preview-runtime@latest -w @dcl-editor/mobile-preview --ignore-scripts --no-audit
```

Review and commit the package/lockfile changes together. Runtime releases and npm
trusted-publisher setup live in the source repository. For the initial release,
`0.1.0` must exist in npm before clean editor installs can succeed. Refresh the
lockfile from that release before merging; the prepared entry has no fabricated
checksum. Local validation can use the source repository's packed tarball.

The runtime requires HTTPS or loopback, WebGPU and the isolation headers provided
by this server. Its fetch bridge relays only active-scene metadata, content and
active-entity lookups; environment variables and server storage are inaccessible.
Messages are scoped to the runtime origin, editor window, session and instance.
No wallet credentials cross the relay. Requests expire after 30 seconds, with a
1 MiB request limit, 4 MiB JSON limit and 64 MiB total buffered response budget.

Screenshots copy the canvas after GPU submission. Scene reload, capture and
visibility messages use the same connection in embedded and detached modes.
Minimize/restore retains the instance and its memory; moving or closing requires
a fresh engine next time. Pausing stops scene processing and GPU rendering;
closing releases the frame and workers. Cold startup and Wasm allocation remain.

To validate, open **Preview → As a phone**, confirm grass and touch controls,
minimize/restore, then move it to a tab. Capture both views. Drag an entity in the
editor, confirm the mobile scene reloads, then undo. Minimize/restore should retain
the instance URL; closing should remove its iframe and workers.
