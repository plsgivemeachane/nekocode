# Pi 0.99.2 compatibility: bundled extensions and retry completion

## Symptoms and cause

Pi 0.99.2 replaces session model registries with `modelRuntime`, removes the
public legacy AuthStorage exports, and makes available-model discovery async.
Keeping the old adapters causes type errors and runtime failures while listing
or selecting models. The patch restores the existing SDK authentication backend exports so the
encrypted adapter retains upstream locking and command/environment key
resolution. Its AuthStorage result implements the public `CredentialStore`
contract and preserves encrypted API keys and OAuth tokens,
including the new `access` and `refresh` fields.

The new `agent_end` event includes `willRetry`. Emitting IPC `done` while it is
true marks the renderer finished while the SDK is still retrying. Both session
adapters now defer `done` during a pending retry. Existing message finalization
and streaming behavior remain intact.

Bundled TypeScript extensions additionally require the embedded static jiti
transform. The worker build defines `PI_BUNDLED_NODE` so upstream chooses this
loader instead of attempting to read `../dist/babel.cjs` relative to the bundle.
The versioned loader patch retains upstream caches, compat aliases, and lazy
module loading while supplying deterministic virtual dependencies, guarded
filesystem resolution, default-export interop, and full error stacks.

## Verification

Session-manager tests cover async model listing and retry completion. Secure
credential tests cover encrypted storage and OAuth round trips. Worker asset
regression tests check package identity/version and missing-package failures.
`node scripts/smoke-worker.cjs` exercises the built worker with a temporary
project and offline provider, including extension imports, create/reconnect,
streaming, models, and extension UI request/response. It does not use account
credentials or make inference requests.

On Node 26, run tests with `NODE_OPTIONS=--no-experimental-webstorage` to keep
Node's global Web Storage from shadowing jsdom's localStorage implementation.

## Clean-install patch failure

The upgraded AWS dependency graph removes both patched `@aws-crypto` packages.
An incremental install can leave old copies behind, hiding the problem; a clean
install reports missing-package patch errors. The original patches are archived
under `docs/patches/archive/` and verified there, while only the installed Pi
package is patched. The destination worktree's clean Bun install exposed and
verified this case. Use `bunx patch-package --error-on-fail` when validating.
