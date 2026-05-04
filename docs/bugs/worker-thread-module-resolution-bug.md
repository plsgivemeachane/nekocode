# Worker Thread ERR_MODULE_NOT_FOUND Bug

## Error

```
ERR_MODULE_NOT_FOUND: Cannot find package '@mariozechner/pi-coding-agent'
imported from C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs
```

## Root Cause Analysis

This bug had multiple compounding issues that caused previous fix attempts to fail:

### Issue 1: ASAR Archive Incompatibility

The SDK package was installed inside `app.asar` (Electron's archive format), but Node.js worker threads don't have Electron's built-in ASAR support. When the worker tried to import the SDK, Node.js couldn't resolve the package path because:

1. The worker file was located outside the ASAR at `resources/workers/worker-bootstrap.mjs`
2. The SDK was inside the ASAR at `app.asar/node_modules/@mariozechner/pi-coding-agent`
3. Node.js ESM module resolution doesn't understand ASAR archives

### Issue 2: Windows Path Detection Bug

In `worker-bootstrap.ts`, the `importSdk()` function had this check:

```typescript
if (sdkPath && sdkPath.startsWith('/')) {
  // Use absolute path import
}
```

This check failed on Windows because Windows paths start with a drive letter (e.g. `C:\Users\...`), not `/`. This caused the worker to fall back to bare package specifier import, which then failed because the package wasn't in the worker's node_modules.

### Issue 3: Dynamic Import Limitations

Even if the path was correct, Node.js ESM `import()` can't resolve files inside ASAR archives because:
- ASAR is an Electron-specific virtual filesystem
- Worker threads use pure Node.js without Electron's ASAR patches
- The module resolver returns `ERR_MODULE_NOT_FOUND` for ASAR paths

## Previous Fix Attempts

1. **Attempt 1**: Pass SDK path via `workerData` - Failed because Windows paths didn't match the Unix path check
2. **Attempt 2**: Fix path detection for Windows - Would still fail due to ASAR incompatibility

## Solution

The fix was to **bundle the SDK directly with the worker** instead of trying to import it at runtime.

### Changes Made

#### 1. Updated `scripts/build-worker.cjs`

Removed `@mariozechner/pi-coding-agent` from the `external` array so esbuild bundles it:

```javascript
external: [
  '@napi-rs/*',
  'electron',
  // REMOVED: '@mariozechner/pi-coding-agent' - now bundled
  'winston',
  'winston-daily-rotate-file',
  'logform',
  '@colors/colors',
],
```

Added WASM file handling:

```javascript
loader: {
  '.wasm': 'copy',
},
```

#### 2. Simplified `worker-bootstrap.ts`

Removed the complex `importSdk()` function and `sdkPath` from `workerData` since the SDK is now bundled.

#### 3. Updated `thread-operation-queue.ts`

Removed `resolveSdkPath()` function and `sdkPath` from worker creation since it's no longer needed.

## Follow-up Issue: package.json ENOENT

After bundling the SDK, a second error appeared:

    ENOENT: no such file or directory, open 'C:\Program Files\Nekocode\resources\workers\package.json'

### Cause

The SDK has a `getPackageDir()` function that walks up from `__dirname` looking for `package.json`. In development, `__dirname` points to the SDK's dist folder inside node_modules, so walking up finds the SDK's `package.json`. After bundling, `__dirname` points to `resources/workers/` which has no `package.json`.

### Fix

The SDK already supported a `PI_PACKAGE_DIR` environment variable override (designed for Nix/Guix store paths). The fix was to resolve the SDK's package directory in the main thread and pass it via `PI_PACKAGE_DIR` env var when creating workers.

## Trade-offs

### Pros
- Worker threads work correctly in packaged app
- No more module resolution issues
- Simpler code (removed complex path resolution logic)

### Cons
- Larger worker file (~11.7MB vs ~33KB) due to bundled SDK and WASM
- Longer build time for worker
- Memory overhead if both main process and worker have their own SDK copy

## Research Sources

Used Firecrawl to research this issue:

1. **GitHub Issue #22446** - "Unable to use files from app.asar in worker_threads"
   - Key insight: Worker threads can't access ASAR contents
   - Workaround mentioned: Use `asar-node` or unpack files

2. **Electron Documentation** - UtilityProcess API
   - Electron's `utilityProcess` is an alternative to Node.js worker_threads
   - Has proper ASAR support since it's an Electron API
   - Future consideration if bundling causes issues

## Files Modified

- `scripts/build-worker.cjs` - Bundle SDK with worker
- `scripts/build-worker-plugin.ts` - Keep in sync with build-worker.cjs
- `src/main/threading/worker-bootstrap.ts` - Remove dynamic import, use bundled SDK
- `src/main/threading/thread-operation-queue.ts` - Resolve SDK package dir and pass via PI_PACKAGE_DIR env var

## Testing

- All existing tests pass (`bun run test`)
- Lint passes (`bun run lint`)
- Type check passes (`bun run type-check`)

## Date

2026-05-02
