# Worker Thread ESM Dynamic Require "os" Bug

## Error

```
Error: Dynamic require of "os" is not supported
    at ThreadOperationQueue.handleWorkerMessage
    at Worker.<anonymous>
```

## Context

This bug appears after the fix for the previous worker-thread-module-resolution-bug.md. The previous bug was solved by bundling the SDK with the worker. However, this introduced a new issue.

## Root Cause Analysis

### Issue: ESM Incompatibility with Dynamic require()

The worker is built as an ESM module (.mjs extension) and the SDK is now bundled with it. However, something in the bundled SDK code uses CommonJS-style require('os'), which is not supported in ESM context.

**Key Points:**

1. Worker Format: The worker is built with format: 'esm' in esbuild config
2. SDK Bundling: The SDK is bundled with the worker
3. Runtime Error: Node.js throws this error when ESM code tries to use require()

### Actual Culprit: supports-color CJS Module

The specific module causing the issue is `supports-color`, which is a dependency of `chalk` (used by the SDK for colored terminal output). The CJS version of `supports-color` contains:

```javascript
var os = require('os');
```

When esbuild bundles this into an ESM output, it converts it to:

```javascript
var os10 = __require("os");
```

Where `__require` is esbuild's generated require proxy. This proxy checks `typeof require !== "undefined"` at IIFE evaluation time to decide whether to delegate to the real `require` or throw the "Dynamic require is not supported" error.

### Why the Banner Fix Works (When It Does)

The banner prepended to the worker file defines:

```javascript
import { createRequire as __nekocode_banner_cr } from 'module';
var __nekocode_banner_req = __nekocode_banner_cr(import.meta.url);
var require = __nekocode_banner_req;
```

Because this `var require = ...` runs before the `__require` IIFE, `typeof require !== "undefined"` evaluates to `"function"`, and `__require` is assigned the banner's `require` polyfill. This makes `__require("os")` work correctly.

### Why the Banner Fix Can Fail

The banner fix depends on execution order:
1. The banner's `var require = ...` MUST execute before the `__require` IIFE
2. `createRequire(import.meta.url)` MUST succeed (requires valid file URL)
3. The `require` variable MUST be in scope when `__require` is evaluated

If any of these conditions are not met (e.g., the banner is missing, `import.meta.url` is invalid, or a scope issue shadows `require`), the `__require` proxy falls through to its inner fallback function which throws the error.

## Fix Applied

### Fix 1: require Polyfill Banner (scripts/build-worker.cjs)

A banner is prepended to the built worker that provides a `require` polyfill using Node.js `createRequire`:

```javascript
import { createRequire as __nekocode_banner_cr } from 'module';
var __nekocode_banner_req = __nekocode_banner_cr(import.meta.url);
var require = __nekocode_banner_req;
var __filename = __nekocode_banner_req('url').fileURLToPath(import.meta.url);
var __dirname = __nekocode_banner_req('path').dirname(__filename);
process.env.PI_PACKAGE_DIR = process.env.PI_PACKAGE_DIR || __nekocode_banner_req('path').join(__dirname, 'pi-package');
```

Key design decisions:
- Uses `__nekocode_banner_` namespace prefix to avoid identifier collisions with bundled code
- Only one ESM import (`createRequire`) to minimize collision surface
- Uses `var` instead of `const`/`let` to allow redeclaration (matches esbuild's own convention)
- Derives `__filename` and `__dirname` via `require()` calls instead of ESM imports
- Falls back to computing `PI_PACKAGE_DIR` if not set by the main process

### Fix 2: PI_PACKAGE_DIR Validation (thread-operation-queue.ts)

Added validation before creating workers to ensure the SDK package directory exists:

```typescript
const piPackageDir = join(dirname(this.workerPath), 'pi-package')
if (!existsSync(piPackageDir)) {
  logger.error(
    `pi-package directory not found at ${piPackageDir}. ` +
    `The SDK may fail to find package.json at runtime. ` +
    `Run 'bun run build:worker' to create it.`
  )
}
```

### Fix 3: SDK Import Validation (worker-bootstrap.ts)

Added validation after importing the SDK to ensure required exports exist. When the SDK partially loads (e.g., due to a dynamic require failure), some exports like SessionManager may be undefined while the module itself appears to have loaded. This provides a clear error message instead of the cryptic "Cannot read properties of undefined (reading 'list')" cascade:

```typescript
async function importSdk() {
  const module = await import('@mariozechner/pi-coding-agent')
  if (!module.SessionManager) {
    throw new Error(
      'SDK module loaded but SessionManager is undefined. ' +
      'This typically means a CJS dependency failed during module evaluation ' +
      '(e.g., "Dynamic require of X is not supported"). ' +
      'Available exports: ' + Object.keys(module).join(', ')
    )
  }
  if (!module.ModelRegistry) {
    throw new Error(
      'SDK module loaded but ModelRegistry is undefined. ' +
      'Available exports: ' + Object.keys(module).join(', ')
    )
  }
  return module
}
```

### Fix 4: Build-Time Validation (scripts/build-worker.cjs)

Added post-build validation steps:
1. Verifies the built worker file starts with the expected require polyfill banner
2. Verifies the `require` assignment is present in the banner
3. Verifies `package.json` exists in the copied `pi-package/` directory

These checks catch issues like missing banners or incomplete SDK asset copies before they cause runtime failures.

## Cascading Failures

The primary error causes several follow-up errors:

1. **SESSION_RECONNECT failed** - SDK import fails, session cannot be created
2. **Session not found** - Previous session was never created, so getModel/loadHistory fail
3. **loadHistoryFromDisk failed** - SessionManager.list is undefined, throws "Cannot read properties of undefined (reading 'list')"
4. **getModel failed** - Session was never registered in the worker's session map

The fix for the cascading errors (Fix 3 above) ensures that when the SDK fails to load properly, a clear error message is returned instead of the cryptic "Cannot read properties of undefined" error.

## Files Modified

- `scripts/build-worker.cjs` - Added banner, build-time validation
- `scripts/build-worker-plugin.ts` - Keep banner in sync with build-worker.cjs
- `src/main/threading/worker-bootstrap.ts` - Added SDK import validation
- `src/main/threading/thread-operation-queue.ts` - Added PI_PACKAGE_DIR validation

## Testing

1. Rebuild the worker: `bun run build:worker`
2. Verify banner is present in output: check first 20 lines of workers/worker-bootstrap.mjs
3. Test in development mode: `bun run dev`
4. Test in production build: `bun run build && bun run start`
5. Verify session reconnection works without errors
6. Run all tests: `bun run test`

## Related Bugs

- worker-thread-module-resolution-bug.md - Original ASAR/module resolution issue
- duplicate-identifier-worker-banner.md - Banner identifier collision issue

## Date

2026-05-02 (original), 2026-05-03 (updated with fix details and robustness improvements)
