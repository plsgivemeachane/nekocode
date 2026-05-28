# Worker Thread Crash: `electron.app` Not Available in Worker Threads

**Date:** 2026-05-28  
**Severity:** Critical (all workers crash-looping)  
**Component:** `src/main/extension-loader.ts` → bundled into `workers/worker-bootstrap.mjs`

## The Bug

All worker threads crashed immediately on startup with:

```
SyntaxError: The requested module 'electron' does not provide an export named 'app'
```

Workers entered an infinite crash loop: crash → "Creating replacement worker" → crash again.

## Root Cause

`extension-loader.ts` had a top-level `import { app } from 'electron'` at line 11. This module is dynamically imported by `worker-bootstrap.ts` (the worker thread entry point). Because the build script (`scripts/build-worker.cjs`) marks `electron` as `external`, esbuild left the import verbatim in the bundled output (`workers/worker-bootstrap.mjs` line 284520).

Electron's `app` module is a **main-process-only** API. When Node.js loads the worker bundle in a `worker_threads` Worker, it encounters `import { app } from "electron"` — but the `electron` module does not export `app` outside the main process. This is a hard ESM instantiation failure that crashes the entire module.

The sole usage of `app` was `app.isPackaged` at line 119, used to truncate stack traces in production logs — a non-critical security/logging feature.

## The Fix

1. **Removed** `import { app } from 'electron'` from `extension-loader.ts`
2. **Removed** the `app.isPackaged` conditional truncation block — truncating logs in production makes debugging harder, not safer. Full stack traces are needed to diagnose extension failures in the field.
3. **Added** a comment explaining why `electron` must not be imported in this module.

## Verification

- `bun run type-check` — passed
- `bun run lint` — passed
- `bun run test` — 66 test files, 1453 tests, all passed
- `bun run build:worker` — rebuilt successfully
- Verified `workers/worker-bootstrap.mjs` no longer contains `import { app } from "electron"`

## Related Files

- `src/main/extension-loader.ts` — the fix
- `src/main/threading/worker-bootstrap.ts` — worker entry point that imports extension-loader
- `scripts/build-worker.cjs` — esbuild config with `electron` as external
- `src/main/threading/thread-operation-queue.ts` — main-thread worker pool manager
