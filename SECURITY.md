# Security

The production deployment target is one Node service process with an exclusive
persistent data volume, behind HTTPS. Read the [service deployment guide](packages/service/README.md#container-deployment)
before exposing it publicly. The Cloudflare adapter is experimental and does not
provide the cross-instance coordination needed for production storage quotas or garbage collection.

The [pre-deployment review](docs/SECURITY-REVIEW.md) records the fixed findings,
verification results and checks still needed against the deployed environment.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option when available,
or contact a maintainer privately. Do not include credentials, private projects,
or exploit details in public issues. Include the affected revision, a minimal
reproduction using synthetic data, and the expected security boundary.
Repository owners must enable private vulnerability reporting before publication.

## Trust boundaries

Wallet signatures identify an account; they do not prove that it is an approved
customer. Production requires an explicit storage wallet policy and, when enabled,
an assistant wallet policy. `*` intentionally permits any wallet; per-wallet limits
alone do not prevent abuse by creating more wallets.

The assistant uses server-held OAuth credentials and can ask the browser to edit
the open project. It has no shell, arbitrary server file access, or download tool.
Treat model output and imported projects as untrusted code. Browser tool validation
and revision checks enforce the boundary; prompts and skills are guidance.

Project uploads are private, wallet-scoped, and returned as inert attachments.
Storage is not end-to-end encrypted. Operators with volume access can read it.
Keep OAuth sessions outside the project directory and restrict backups accordingly.

## Release checks

From the repository root, run:

```sh
npm ci --ignore-scripts
npm run validate
node scripts/check-secrets.mjs --history
npm audit --workspace @dcl-editor/service --omit=dev --audit-level=moderate
docker build -f packages/service/Dockerfile -t dcl-editor-service:local .
node packages/service/scripts/docker-smoke.mjs
```

The credential check reports locations, never matching values. It checks common
token and private-key patterns, not every possible secret. Environment and OAuth
files are rejected by filename without reading their contents. If a credential was
ever committed, revoke it and assess reachable Git history before publication.

Keep deployment secrets out of Git, Docker build arguments, logs, and browser
configuration. Use protected deployment environments and review dependency updates.
The root protobuf override replaces vulnerable legacy SDK dependencies; retain
the service and content-hash regression tests when changing it. The service pins
an HTTP-client peer so the agent cannot inherit the desktop SDK toolchain's older copy.
