# SDK Patch Guide: `@mariozechner/pi-coding-agent`

> **Target version:** `0.74.0`  
> **Patch file:** `patches/@earendil-works+pi-coding-agent+0.74.0.patch`  
> **Purpose:** Recreate the patch-package diff from this document alone.  
> **Bug references:** `docs/bugs/extension-typebox-resolve-failure.md`, `docs/bugs/pi-extension-load-failure-bug.md`, `docs/bugs/extension-load-pi-agent-core-resolution-bug.md`

---

## Overview

NekoCode bundles the Pi SDK (`@mariozechner/pi-coding-agent`) into a worker ESM file via esbuild.
This creates several runtime failures that do not occur when the SDK runs normally from `node_modules/`.
The patches below fix those failures by modifying the SDK's **dist** files in `node_modules/` before
`patch-package` captures the diff.

All patches target **one file**: `dist/core/extensions/loader.js` (the extension loader).
Source maps (`.map`) and declaration maps (`.d.ts.map`) should be regenerated or deleted after patching
— they are cosmetic and do not affect runtime.

---

## Patch 1 — TypeBox `require.resolve` try/catch

**Bug:** `docs/bugs/extension-typebox-resolve-failure.md`

### Problem

`getAliases()` calls `require.resolve("typebox")` unconditionally. In the bundled worker
context there is no `node_modules/` on disk, so this throws `ERR_MODULE_NOT_FOUND` and all 19
extensions fail to load.

### File

`node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`

### Locate

Find the `getAliases()` function. It contains:

```js
const typeboxEntry = require.resolve("typebox");
const typeboxCompileEntry = require.resolve("typebox/compile");
const typeboxValueEntry = require.resolve("typebox/value");
```

### Replace with

Wrap every `require.resolve` for typebox in a `try/catch`. When resolution fails, the variable
defaults to `""` and the alias is skipped — jiti resolves typebox through `virtualModules` instead.

```js
// In bundled contexts (e.g. esbuild worker bundle), typebox is inlined
// and not available on disk. virtualModules already provides it, so we can safely
// skip the alias when require.resolve fails.
let typeboxEntry = "";
let typeboxCompileEntry = "";
let typeboxValueEntry = "";
try {
    typeboxEntry = require.resolve("typebox");
} catch {}
try {
    typeboxCompileEntry = require.resolve("typebox/compile");
} catch {}
try {
    typeboxValueEntry = require.resolve("typebox/value");
} catch {}
```

Also add a cache key so the alias map is invalidated when `cwd` or `NODE_PATH` changes:

```js
let _aliases = null;
let _aliasesKey = null;
function getAliases() {
    const contextKey = `${process.cwd()}|${process.env.NODE_PATH ?? ""}`;
    if (_aliases && _aliasesKey === contextKey)
        return _aliases;
    // ... build aliases ...
    _aliasesKey = contextKey;
    return _aliases;
}
```

---

## Patch 2 — `resolveWorkspaceOrImport` try/catch for `import.meta.resolve`

**Bug:** `docs/bugs/extension-load-pi-agent-core-resolution-bug.md`

### Problem

`getAliases()` calls `resolveWorkspaceOrImport()` for each workspace package
(`@mariozechner/pi-agent-core`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`,
`@mariozechner/pi-ai/oauth`). When the workspace path doesn't exist on disk (production worker),
the function falls through to `import.meta.resolve(specifier)`, which throws `ERR_MODULE_NOT_FOUND`
because `node_modules/` doesn't exist adjacent to the bundled worker.

This crash happens **before** jiti is created, so `VIRTUAL_MODULES` (which already has the correct
mappings) is never reached. All 19 extensions fail identically.

### File

Same file: `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`

### Locate

Find the `resolveWorkspaceOrImport` arrow function inside `getAliases()`:

```js
const resolveWorkspaceOrImport = (workspaceRelativePath, specifier) => {
    const workspacePath = path.join(packagesRoot, workspaceRelativePath);
    if (fs.existsSync(workspacePath)) {
        return workspacePath;
    }
    return fileURLToPath(import.meta.resolve(specifier));
};
```

### Replace with

Wrap `import.meta.resolve()` in a try/catch. When resolution fails, return the specifier itself
so jiti treats it as a no-op alias and falls through to `VIRTUAL_MODULES`:

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

---

## Patch 3 — `interopDefault` for extension module loading

**Bug:** `docs/bugs/pi-extension-load-failure-bug.md`

### Problem

When jiti loads an ESM extension that was transpiled to CJS by esbuild, `module.default` may be
`undefined` even though the module object itself contains the exports. The original code passes
`module` directly as the factory, but `(void 0)()` crashes.

### File

Same file: `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`

### Locate

Find the `loadExtensionModule` function. It ends with:

```js
const module = await jiti.import(extensionPath, { default: true });
const factory = module;
return typeof factory !== "function" ? undefined : factory;
```

### Add before `loadExtensionModule`

Insert this helper function:

```js
/**
 * Properly extract the default export from a module, handling cases where
 * the default export is explicitly null or undefined.
 * This fixes the '(void 0) is not a function' error when loading extensions.
 */
function interopDefault(mod) {
    // Handle non-objects (functions, primitives) directly
    if (mod === null || typeof mod !== 'object') {
        return mod;
    }
    // Check if the module has a 'default' key
    for (const [key, value] of Object.entries(mod)) {
        if (key === 'default') {
            const defIsNil = value === null || value === undefined;
            return defIsNil ? mod : value;
        }
    }
    return mod;
}
```

### Replace in `loadExtensionModule`

```js
const module = await jiti.import(extensionPath, { default: true });
const factory = interopDefault(module);
return typeof factory !== "function" ? undefined : factory;
```

---

## Patch 4 — Always provide `virtualModules`

### Problem

The original code only passes `virtualModules` in Bun binary mode. In the NekoCode worker (Node.js
ESM bundle), jiti falls back to filesystem resolution, which fails because bundled packages don't
exist on disk.

### File

Same file: `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`

### Locate

Inside `loadExtensionModule`, the jiti creation:

```js
const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    ...(isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),
});
```

### Replace with

```js
const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    // Always provide virtualModules so core packages resolve deterministically.
    // In Node/dev we keep aliases for non-bundled paths, but disable tryNative so
    // jiti resolves imports consistently instead of mixing native/module paths.
    virtualModules: VIRTUAL_MODULES,
    tryNative: false,
    ...(isBunBinary ? {} : { alias: getAliases() }),
});
```

---

## Patch 5 — Extension error stack traces (minor)

### Problem

Extension load errors only show the message, not the stack trace, making debugging difficult.

### Locate

In the `loadExtension` function's catch block:

```js
catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { extension: null, error: `Failed to load extension: ${message}` };
}
```

### Replace with

```js
catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    return { extension: null, error: `Failed to load extension: ${message}${stack ? `\n${stack}` : ""}` };
}
```

---

## Regenerating the patch file

After applying all edits to `node_modules/@mariozechner/pi-coding-agent/`:

```bash
bunx patch-package @mariozechner/pi-coding-agent
```

This creates/updates `patches/@mariozechner+pi-coding-agent+0.73.1.patch`.

> **Important:** Delete `.map` files from the patch if they bloat the diff. Source maps are not
> needed at runtime and can be regenerated. The patch file should ideally contain only `.js` and
> `.d.ts` changes.

---

## Verification checklist

After patching:

1. `bun run build-worker` — worker builds without errors
2. `bun run test` — all tests pass
3. `bun run lint` — no lint errors
4. `bun run type-check` — type check passes
5. Launch app -> extensions load successfully (check console for `Extensions loaded: N` with no errors)
6. Session reconnect works without `Cannot find module 'typebox'` or `Cannot find package '@mariozechner/pi-agent-core'`
