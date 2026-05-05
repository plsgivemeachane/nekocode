# Extension Load Failure: `Cannot find package '@mariozechner/pi-agent-core'` in Bundled Worker

> **Status:** Fixed
> **Affected:** NekoCode production builds (worker-bootstrap.mjs)
> **Date:** 2026-05-05
> **SDK Version:** `@mariozechner/pi-coding-agent@0.73.0`

---

## 1. Phenomenon

All 19 extensions fail to load during session reconnect with the identical error:

    Cannot find package '@mariozechner/pi-agent-core' imported from C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs

Error count: Extensions loaded: 0, errors: 19

Each extension produces the same `ERR_MODULE_NOT_FOUND` for `@mariozechner/pi-agent-core`. Affected extensions include:

| # | Extension Path | Type |
|---|----------------|------|
| 0 | `pi-context/src/index.ts` | npm package |
| 1 | `pi-context/src/context.ts` | npm package |
| 2 | `pi-ask-user/index.ts` | npm package |
| 3 | `@plannotator/pi-extension` | npm package (index) |
| 4 | `lsp-pi/lsp.ts` | npm package |
| 5 | `lsp-pi/lsp-tool.ts` | npm package |
| 6-18 | Built-in extensions (auto-session-name, auto-update, compact-header, etc.) | Local |

The error includes the full stack trace:

    Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@mariozechner/pi-agent-core' imported from C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs
        at packageResolve (node:internal/modules/esm/resolve:880:9)
        at moduleResolve (node:internal/modules/esm/resolve:953:18)
        at defaultResolve (node:internal/modules/esm/resolve:1195:11)
        ...
        at resolveWorkspaceOrImport (file:///C:/Program%20Files/Nekocode/resources/workers/worker-bootstrap.mjs:249026:39)
        at getAliases (file:///C:/Program%20Files/Nekocode/resources/workers/worker-bootstrap.mjs:249030:36)

---

## 2. Root Cause

### The `resolveWorkspaceOrImport` function lacks a try/catch in the bundled worker context

In `loader.js` (SDK dist), the `getAliases()` function builds a module alias map for jiti. When `isBunBinary` is `false` (the NekoCode worker is a Node.js ESM bundle, not a Bun binary), `getAliases()` is called to populate the alias map:

```js
const resolveWorkspaceOrImport = (workspaceRelativePath, specifier) => {
    const workspacePath = path.join(packagesRoot, workspaceRelativePath);
    if (fs.existsSync(workspacePath)) {
        return workspacePath;
    }
    return fileURLToPath(import.meta.resolve(specifier)); // THROWS HERE
};
_aliases = {
    "@mariozechner/pi-coding-agent": packageIndex,
    "@mariozechner/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@mariozechner/pi-agent-core"),
    // ...
};
```

The call chain:
1. `packagesRoot` = `path.resolve(__dirname, "../../../../")` → In the bundled worker, `__dirname` = `C:\Program Files\Nekocode\resources\workers\`, so `packagesRoot` = `C:\Program Files\Nekocode\`
2. `workspacePath` = `C:\Program Files\Nekocode\agent\dist\index.js` → Does NOT exist on disk
3. Falls through to `import.meta.resolve("@mariozechner/pi-agent-core")` → **THROWS** `ERR_MODULE_NOT_FOUND` because there is no `node_modules/@mariozechner/pi-agent-core` relative to `C:\Program Files\Nekocode\resources\workers\`

### Why VIRTUAL_MODULES doesn't help

The patched `loader.js` (v0.73.0) correctly defines `@mariozechner/pi-agent-core` in `VIRTUAL_MODULES` and passes `virtualModules: VIRTUAL_MODULES` to jiti. However, the `getAliases()` function crashes **before** jiti is ever created, so `VIRTUAL_MODULES` is never reached.

The jiti creation (line 310-315) is:

```js
const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    virtualModules: VIRTUAL_MODULES,
    tryNative: false,
    ...(isBunBinary ? {} : { alias: getAliases() }),  // getAliases() CRASHES
});
```

Since `getAliases()` throws, the entire `loadExtensionModule()` call fails, and the catch block in `loadExtension()` produces the "Failed to load extension" message.

### Why all 19 extensions fail identically

`getAliases()` is called once per `loadExtensionModule()` invocation. Every extension goes through the same code path and hits the same crash. The alias map construction is not cached (it crashes before `_aliases` is assigned), so every attempt triggers the same `ERR_MODULE_NOT_FOUND`.

---

## 3. The Gap in the v0.73.0 Patch

The current patch (`patches/@mariozechner+pi-coding-agent+0.73.0.patch`) addresses:
- ✅ TypeBox `require.resolve` try/catch
- ✅ Cache key invalidation (`_aliasesKey`)
- ✅ `interopDefault` for extension module loading
- ✅ Always providing `virtualModules` to jiti
- ✅ Stack traces in extension load errors

But it does **NOT** address:
- ❌ `resolveWorkspaceOrImport` crashing on `import.meta.resolve()` for `@mariozechner/pi-agent-core`
- ❌ `resolveWorkspaceOrImport` crashing on `import.meta.resolve()` for `@mariozechner/pi-tui`
- ❌ `resolveWorkspaceOrImport` crashing on `import.meta.resolve()` for `@mariozechner/pi-ai`
- ❌ `resolveWorkspaceOrImport` crashing on `import.meta.resolve()` for `@mariozechner/pi-ai/oauth`

The `PATCH_GUIDE.md` (written for v0.72.1) describes this fix in Patch 1, including fallback paths:

```js
"@mariozechner/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@mariozechner/pi-agent-core", /* fallbackPath */),
```

But the v0.73.0 patch was generated without this fix — the third `fallbackPath` parameter and the `resolveWorkspaceOrImport` error handling are missing.

---

## 4. Why This Only Affects Production

In development, the worker runs from the project directory where `node_modules/@mariozechner/pi-agent-core` exists. `import.meta.resolve("@mariozechner/pi-agent-core")` succeeds because Node.js resolves it through the `node_modules` hierarchy.

In production, the worker is a bundled ESM file at `C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs` with no `node_modules` adjacent to it.

---

## 5. Evidence and Related Bugs

### Related bug reports

| Bug Report | Relationship |
|------------|-------------|
| `extension-typebox-resolve-failure.md` | Same pattern: `require.resolve("@sinclair/typebox")` crashing in bundled worker. Fixed by try/catch. This bug is the same pattern but for `import.meta.resolve()` in `resolveWorkspaceOrImport()`. |
| `worker-thread-module-resolution-bug.md` | Historical: worker couldn't find SDK at all (ASAR + Windows path). Fixed by bundling SDK with worker. This bug is a downstream consequence of that bundling. |
| `worker-esm-dynamic-require-os-bug.md` | Historical: `require('os')` in ESM context. Fixed by require polyfill banner. Not directly related but same bundled worker context. |
| `pi-extension-load-failure-bug.md` | `(void 0) is not a function` from jiti default export handling. Different root cause but same symptom (all extensions fail). |
| `m2m-extension-load-failure.md` | M2M headless pipeline extension failures. Documents the `(void 0) is not a function` error pattern and the `getAliases()` alias cache issue. Section 5 (Root Cause Hypothesis) identifies stale alias cache as a contributing factor. |
| `PATCH_GUIDE.md` | Describes the intended fix for this exact issue in Patch 1 — `resolveWorkspaceOrImport` with `fallbackPath` parameter. The fix was not carried forward to the v0.73.0 patch. |

### Evidence from log output

```
2026-05-05 14:16:22 [extension-loader] error: [reconnect] Extension load error path=C:\Users\admin\AppData\Roaming\npm\node_modules\pi-context\src\index.ts
    message=Failed to load extension: Cannot find package '@mariozechner/pi-agent-core'
    imported from C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs

Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@mariozechner/pi-agent-core' imported from C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs
    at packageResolve (node:internal/modules/esm/resolve:880:9)
    at moduleResolve (node:internal/modules/esm/resolve:953:18)
    ...
    at resolveWorkspaceOrImport (file:///C:/Program%20Files/Nekocode/resources/workers/worker-bootstrap.mjs:249026:39)
    at getAliases (file:///C:/Program%20Files/Nekocode/resources/workers/worker-bootstrap.mjs:249030:36)

2026-05-05 14:16:22 [extension-loader] info: [reconnect] Extensions loaded: 0, errors: 19
```

Key observations:
- All 19 errors are identical (`Cannot find package '@mariozechner/pi-agent-core'`)
- The stack trace points to `resolveWorkspaceOrImport` → `getAliases` in the bundled worker
- The error occurs at runtime during module resolution (not at bundle time)
- Extensions loaded: 0 confirms total failure

---

## 6. Fix Applied

### Approach: Wrap `resolveWorkspaceOrImport` in try/catch, return specifier on failure

In the SDK patch, wrap the `import.meta.resolve()` fallback in `resolveWorkspaceOrImport`.
When resolution fails (bundled worker context), return the specifier itself so jiti treats
it as an un-aliased import and falls through to `VIRTUAL_MODULES`:

```js
const resolveWorkspaceOrImport = (workspaceRelativePath, specifier) => {
    const workspacePath = path.join(packagesRoot, workspaceRelativePath);
    if (fs.existsSync(workspacePath)) {
        return workspacePath;
    }
    try {
        return fileURLToPath(import.meta.resolve(specifier));
    } catch {
        // In bundled worker context (production), node_modules doesn't exist
        // on disk, so import.meta.resolve throws ERR_MODULE_NOT_FOUND.
        // Return the specifier itself so jiti falls through to VIRTUAL_MODULES.
        return specifier;
    }
};
```

### Why return `specifier` instead of `""`

Returning `""` could cause jiti to attempt resolving an empty string path, which may
throw internally. Returning the specifier (e.g. `"@mariozechner/pi-agent-core"`) means
the alias map entry becomes `{"@mariozechner/pi-agent-core": "@mariozechner/pi-agent-core"}`,
which is effectively a no-op alias. When jiti encounters this during extension loading,
it checks `VIRTUAL_MODULES` (which already contains the correct mapping) and resolves
successfully.

### Regenerated patch file

`patches/@mariozechner+pi-coding-agent+0.73.0.patch` — regenerated via `bunx patch-package`.

---

## 7. Verification

- Type check: `bun run type-check` — clean
- Lint: `bun run lint` — clean
- Tests: `bun run test` — 27 files, 620 tests passed
- Worker rebuild: `bun run build:worker` — passed, banner + pi-package validated

## 8. Impact

- **Severity:** Critical — all extensions fail to load, sessions cannot be created or reconnected
- **Scope:** Production builds only (worker-bootstrap.mjs)
- **Workaround:** None — the crash happens in the SDK's extension loader before any fallback logic in NekoCode's `extension-loader.ts` can engage

---

## 9. Date

2026-05-05
