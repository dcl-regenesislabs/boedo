# Service security review — 2026-10-03

Reviewed the browser assistant, signed project storage, OAuth boundary, dependencies,
and single-process Node deployment. The fixes below are implemented on
`fix/service-security`, prepared against `ec8b763` and integrated with PR #89's
`a5f21df` base. No production deployment was performed.

## Findings and fixes

| Finding | Fix and regression coverage |
|---|---|
| Purge freed wallet quota without removing the underlying blob bytes. Repeated uploads could exhaust disk. | Reclaim unowned blobs after the grace period; preserve shared blobs and retained history. `packages/service/src/security.test.ts` covers both cases. |
| Failed uploads accumulated spent-ticket files faster than purge removed them, and purge reported completion with expired tickets remaining. | Cap retained tickets, reclaim expired entries on admission, and continue incomplete sweeps. Covered in `security.test.ts`. |
| Tokenless WebSocket upgrades could occupy capacity intended for legitimate tickets. | Validate the single-use ticket during the upgrade, before accepting the socket. `packages/service/src/ai/server.test.ts` covers tokenless admission. |
| Concurrent WebSocket handshakes could exceed the global connection cap. | Reserve capacity synchronously, counting pending and connected clients together. Covered in `ai/server.test.ts`. |
| Concurrent creation of different project IDs could bypass a wallet's project limit. | Serialize storage mutations and garbage collection under one process lock. Covered in `security.test.ts`. |
| Service dependencies included published vulnerabilities, including WebSocket fragmentation resource exhaustion. | Update the agent and transport dependencies and pin patched transitive dependencies. Test fragmented messages and verify the actual image's resolved versions. |

Additional controls include aggregate storage byte and object limits, a filesystem
free-space reserve, production wallet allowlists, bounded request bodies and
deadlines, strict HTTPS configuration, and an agent tool allowlist. The container
runs without root, with a read-only root filesystem and resource limits. The
experimental Worker adapter rejects public traffic.

Run the focused regression suite from the repository root:

```sh
npx vitest run packages/service/src/security.test.ts packages/service/src/ai/server.test.ts packages/service/src/ai/pi.test.ts packages/service/src/components.test.ts
```

## Verification

- `npm run validate`: passed lint, all package typechecks, 2,383 tests in 206 files,
  and scene, UI and desktop builds.
- Web build and Chromium smoke: passed all 25 checks, including signed assistant
  connection and browser tool calls with an injected test agent.
- Production service dependency audit: zero reported vulnerabilities at review time.
- Credential-pattern scan: no findings in the current source or reachable HEAD history.
  This is a heuristic check, not proof that every possible secret is absent.
- Docker smoke: passed signed storage, restart persistence, restricted-container
  operation, offline agent initialization and shutdown. The image resolved
  `ws` 8.22.0, agent 1.0.1 and the OpenAI client's `undici` peer 8.11.2.
- Nginx template: `nginx -t` passed with a temporary certificate and test hostname.
- Desktop runtime: boot and picker passed; engine console RPC timed out before
  the editor scene attached. Subsequent desktop checks did not run. The cause
  remains unresolved; this review does not establish that it predates these changes.

## Worlds management signing (host contract v1.2)

Host contract v1.2 ([HOST-CONTRACT.md](HOST-CONTRACT.md)) widens the signing boundary. Beside a .zone/.org Worlds server, the pinned editor can now get scene-shaped signatures (pathname only, metadata it chooses, e.g. `signer: decentraland-kernel-scene`) for the player's wallet on Worlds content, comms-gatekeeper, storage, multiplayer `/logs` and creators-data. Guards: exact per-environment host allow-list (no userinfo, ports, lookalikes or cross-environment), a method allow-list per service, multiplayer limited to GET `/logs`, the editor's own `dcl:editor` metadata refused there (so these signatures cannot be replayed at the project service), and a page dialog before a scene or whole-world undeploy. Other Worlds DELETEs (permissions, access lists) are not confirmed. A signature is replayable within each service's timestamp window, and since the query is unsigned, against any query on the same path and method. This still rests on L1: the editor is trusted like the HUD bundle.

## Deployment limits and remaining checks

Use the [Node deployment guide](../packages/service/README.md#container-deployment)
with one process and exclusive volume access. Deploy the updated browser and
service together: the WebSocket authentication protocol changed.

The droplet's actual firewall, TLS certificate, DNS, secrets and live OAuth/model
request have not been verified. Tests used synthetic credentials and did not call
a paid model. Start with explicit wallet allowlists; `*` intentionally admits any
wallet. Logical storage limits do not include filesystem allocation overhead.

Before public release, resolve or isolate the desktop runtime failure, run a live
assistant turn against the deployed HTTPS endpoint, and enable private vulnerability
reporting in the repository settings. See [SECURITY.md](../SECURITY.md) for release checks
and the trust boundaries. This review is not an independent penetration test.

## Mobile preview review — 2026-10-15

The mobile runtime source and graphics fixtures now live in the `test-godot-web`
parent workspace and its pinned engine/explorer submodules. The editor retains its
npm runtime package, hosting, transport and UI. No package, branch or deployment
was published during this review.

Fixed the resource relay's access to privileged realm routes: mobile scene workers
could borrow the editor window's service-worker identity to read environment or
server storage. It now permits only scene metadata, content and active-entity
lookups, with timeouts and bounded response buffering. Regression tests reject
environment/storage requests before fetch, along with traversal and wrong methods;
ten cases failed before the restriction. Tests use synthetic data, not secrets.

Also fixed preview launch cancellation, deferred runtime pausing until startup,
checked the complete npm artifact inventory before packing, and removed local
machine paths from the export. The migrated local static server now rejects path
and symlink escapes and streams assets. Exports import resources first and fail
on script/resource errors, including when Godot exits successfully.

Validation: after rebasing onto current main, editor `npm run validate` passed all six
checks and the explorer's 757 tests passed in the local timezone. The badge-date fixture
now uses a mid-month timestamp. Nine export, lifecycle, shader-build and server tests pass.
The service container builds with a verified mobile runtime and passes its restricted
container, signed-storage, restart and shutdown smoke test. That test also verifies
mobile Wasm delivery and denial of non-artifact files. Workflow syntax passes actionlint.

The initial migrated browser export loaded one scene worker and produced an inspected
1024×461 screenshot. Minimized preview: zero mobile GPU submissions over three seconds,
while the editor ran at 60 FPS. The mobile Wasm heap was 494.75 MiB; this is not total
browser RSS. Both original graphics fixtures passed with the migrated binaries.

A buffer-coherence fixture reproduced five stale-data failures on the old engine after
CPU updates, clears, copies, read-only shader use and a GPU write. The driver now submits
queued changes before readback, updates CPU mirrors and invalidates them before writable
shader use. Pending GPU reads return empty data instead of taking a synchronous fallback.
The clean engine build and all three fixture exports pass. The native/browser library
build is in progress; final graphics and editor lifecycle checks are still pending.
Automatic approval review could not start the Linux browser check because account usage
capacity was exhausted. This is not a passing browser result. Native phone tests have not run.

Dependency review uses the downloaded public OSV npm database and an offline scanner;
no private dependency list is uploaded. The service's 91 production packages have no
reported vulnerabilities. The full editor lockfile has findings against 19 package
versions, all already present on main: older SDK/test-tool transitive packages and the
desktop Electron package. These are baseline maintenance findings, not introduced by
the mobile runtime. The public explorer's production npm audit also reported zero.
Local credential-pattern scans found no matches in changed source.

The browser runtime's 283 registry crates pass the offline OSV check after updates to
anyhow, bytes, keccak, protobuf, rand, Tokio and tracing-subscriber. Three maintenance-only
notices for core2, instant and multipart have explicit exceptions until November 15, 2026;
no vulnerability advisory is exempted. The full native Godot and Bevy lockfiles still
contain pre-existing RustSec findings; this does not establish that those runtimes are
vulnerability-free. Bevy's lockfile is unchanged, including findings in its browser graph
(crossbeam-epoch, quick-xml, ringbuf, ruint and ruzstd) that require separate dependency
upgrades. Browser isolation does not replace those upgrades.

CI builds the pinned Godot source, packages the runtime and includes it in service
images. The image build fails when artifacts are absent or changed. Production dependency
checks in CI use the same offline OSV approach, including cached runtime exports. The
scanner binary is version-pinned and checksum-verified. Inherited release workflows are
disabled in the source forks, and branch names in the inherited distribution workflow
are passed through environment variables rather than inserted into shell code.
GitHub requires a read-only
`GODOT_SOURCE_TOKEN` for the private source repositories; no credential was added and
no remote workflow was dispatched. Submodule commits and the parent pin are prepared
locally. Nothing has been pushed, published or deployed.
