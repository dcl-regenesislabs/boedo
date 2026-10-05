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
