# Mobile preview runtime

`@dcl-regenesislabs/mobile-preview-runtime` packages the mobile client's web export separately
from the editor UI. It is fetched only when the user opens **As a phone**. The editor owns its
server, scene relay, lifecycle and captures; bevy-explorer needs no mobile runtime dependency
or configuration.

Runtime source and graphics tests live in the `test-godot-web` workspace. Run
`./build.sh preview` there after building its engine and library. Prepare and pack its
`godot-explorer/build/web` output from this repository root:

```sh
npm run build -w @dcl-regenesislabs/mobile-preview-runtime -- /path/to/mobile/build/web
npm pack -w @dcl-regenesislabs/mobile-preview-runtime --pack-destination /tmp
```

The export must include the local-editor-preview protocol and the nonblocking web frame
limiter. The build copies only runtime artifacts, adds the editor transport, and writes a
size/SHA-256 manifest. `prepack` verifies every artifact. Generated binaries stay out of Git.
Packing creates a tarball locally; it does not publish anything. The package includes the mobile
client's Apache license and the engine's license/copyright notices. Keep these notices and any
additional export-specific attributions when preparing a release.

For development, set `MOBILE_PREVIEW_EXPORT=/path/to/mobile/build/web` before `npm run dev:web`.
The editor prepares the package and serves it at `http://127.0.0.1:8788/mobile-preview/`.
Start only that server with `npm run serve -w @dcl-regenesislabs/mobile-preview-runtime`.
The loopback IP deliberately differs from the editor's `localhost` site to isolate startup.

The service image requires this workspace's prepared `dist`; its build verifies the
manifest and refuses missing or modified artifacts. The service exposes `/mobile-preview/`.
A source-only development server still returns 503 until the runtime is prepared.
Runtime versions can be released independently of the editor UI.

CI reads the exact Godot workspace commit from `source.json`, builds its pinned submodules,
and uploads both the prepared runtime and npm tarball. Service-image checks and deployment
consume that artifact, including in Docker's build context. The raw export is cached by
source commit; changes to the editor's transport are always packaged again. The
browser dependency advisory scan runs again even when the export is cached. The
`mobile-preview.yml` workflow can also be run manually. Publishing is an explicit, default-off
input and uses the production environment and npm trusted publishing. The first publish
and npm trusted-publisher registration must be performed by a maintainer.

GitHub setup: add `GODOT_SOURCE_TOKEN` to this repository, with read-only Contents access
to `kuruk-mm/test-godot-web`, `kuruk-mm/godot-explorer-test` and `kuruk-mm/dclgodotengine`.
The token is used only during checkout and is not persisted in the checkout. Never put
it in this repository or an artifact. Prepare the `source.json` pin locally, then push
the source submodule commits and parent commit before the editor branch. Their checks
must pass before merging the editor. The npm tarball includes this source pin.
No package has been published by this change.

The runtime requires HTTPS or loopback, WebGPU and the isolation headers provided by its server.
Its fetch bridge relays only the active scene's requests to the editor, where the browser-local
preview realm lives. The bridge covers the runtime and scene workers without third-party storage.
Messages are checked against the runtime origin, editor window, session and instance. No wallet
credentials cross the relay. Only scene metadata, content hashes and active-entity lookups are
relayed; environment variables and server storage are inaccessible. Requests time out after
30 seconds, with a 1 MiB request limit, 4 MiB JSON response limit and 64 MiB total buffered
response budget. Assets larger than that budget return an error.
Screenshots copy the canvas after a GPU frame submission, before presentation clears it.
Scene rebuilds, screenshots and visibility messages use that same connection, including
when the preview moves to a separate tab. The detached tab keeps a same-origin shell around
the runtime iframe so browser isolation preserves its connection to the editor.
Moving or closing starts a fresh engine next time;
minimize/restore retains the instance and its memory without another startup.

The package does not eliminate the runtime's initial loading cost or its WebAssembly memory
allocation. It isolates startup from the editor UI, and pausing stops scene processing and
GPU rendering. Closing releases the frame and its workers.

To check a packaged runtime locally, open **Preview → As a phone**, minimize and restore it,
then move it to another tab. Confirm the same scene renders, screenshots contain the scene and
touch controls, and a scene rebuild replaces its worker while the editor stays usable.
Minimize/restore should keep the same instance URL; closing should remove its iframe and workers.
