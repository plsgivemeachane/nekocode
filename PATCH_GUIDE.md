# SDK Patch Guide: `@mariozechner/pi-coding-agent`

> **Target version:** `0.72.1`  
> **Patch file:** `patches/@mariozechner+pi-coding-agent+0.72.1.patch`  
> **Purpose:** Recreate the patch-package diff from this document alone.  
> **Bug references:** `docs/bugs/extension-typebox-resolve-failure.md`, `docs/bugs/pi-extension-load-failure-bug.md`

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

`getAliases()` calls `require.resolve("@sinclair/typebox")` unconditionally. In the bundled worker
context there is no `node_modules/` on disk, so this throws `ERR_MODULE_NOT_FOUND` and all 19
extensions fail to load.

### File

`node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`

### Locate

Find the `getAliases()` function. It contains:

```js
const typeboxEntry = require.resolve("@sinclair/typebox");
const typeboxRoot = typeboxEntry.replace(/[\\/]build[\\/]cjs[\\/]index\.js$/, "");
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

Also update the `_aliases` object to use the new variables and include the TypeBox 1.x names:

```js
_aliases = {
    "@mariozechner/pi-coding-agent": packageIndex,
    "@mariozechner/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@mariozechner/pi-agent-core", /* fallbackPath */),
    "@mariozechner/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@mariozechner/pi-tui", /* fallbackPath */),
    "@mariozechner/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@mariozechner/pi-ai", /* fallbackPath */),
    "@mariozechner/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@mariozechner/pi-ai/oauth", /* fallbackPath */),
    typebox: typeboxEntry,
    "typebox/compile": typeboxCompileEntry,
    "typebox/value": typeboxValueEntry,
    "@sinclair/typebox": typeboxEntry,
    "@sinclair/typebox/compile": typeboxCompileEntry,
    "@sinclair/typebox/value": typeboxValueEntry,
};
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

## Patch 2 — `interopDefault` for extension module loading

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

## Patch 3 — Always provide `virtualModules`

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

## Patch 4 — TypeBox 1.x `VIRTUAL_MODULES` entries

### Problem

The SDK migrated from `@sinclair/typebox` (0.x) to `typebox` (1.x). Extensions that import from
`typebox`, `typebox/compile`, or `typebox/value` need virtual module entries for the new package
names.

### File

Same file, at the top where `VIRTUAL_MODULES` is defined.

### Locate

```js
const VIRTUAL_MODULES = {
    "@sinclair/typebox": _bundledTypebox,
    // ...
};
```

### Extend with

```js
const VIRTUAL_MODULES = {
    typebox: _bundledTypebox,
    "typebox/compile": _bundledTypeboxCompile,
    "typebox/value": _bundledTypeboxValue,
    "@sinclair/typebox": _bundledTypebox,
    "@sinclair/typebox/compile": _bundledTypeboxCompile,
    "@sinclair/typebox/value": _bundledTypeboxValue,
    "@mariozechner/pi-agent-core": _bundledPiAgentCore,
    "@mariozechner/pi-tui": _bundledPiTui,
    "@mariozechner/pi-ai": _bundledPiAi,
    "@mariozechner/pi-ai/oauth": _bundledPiAiOauth,
    "@mariozechner/pi-coding-agent": _bundledPiCodingAgent,
};
```

> **Note:** The imports `_bundledTypeboxCompile` and `_bundledTypeboxValue` must also be added at
> the top of the file alongside the existing `_bundledTypebox` import:
> ```js
> import * as _bundledTypebox from "typebox";
> import * as _bundledTypeboxCompile from "typebox/compile";
> import * as _bundledTypeboxValue from "typebox/value";
> ```

---

## Patch 5 — Stale extension context protection (optional, recommended)

### Problem

After session replacement (`ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()`), captured
references to the old `pi` API or command `ctx` silently target the wrong session. This causes
confusing bugs in extensions.

### File

Same file: `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`

### Logic

1. In `createExtensionRuntime()`, add a `state` object and an `assertActive()` guard:

```js
const state = {};
const assertActive = () => {
    if (state.staleMessage) {
        throw new Error(state.staleMessage);
    }
};
```

2. Add `assertActive` and `invalidate` to the runtime object:

```js
const runtime = {
    // ... existing fields ...
    assertActive,
    invalidate: (message) => {
        state.staleMessage ??=
            message ??
            "This extension ctx is stale after session replacement or reload. " +
            "Do not use a captured pi or command ctx after ctx.newSession(), " +
            "ctx.fork(), ctx.switchSession(), or ctx.reload().";
    },
};
```

3. Call `runtime.assertActive()` at the top of every method in the `api` object returned by
   `createExtensionAPI()` — `on()`, `registerTool()`, `registerCommand()`, `registerShortcut()`,
   `registerFlag()`, `registerMessageRenderer()`, `getFlag()`, `sendMessage()`, `sendUserMessage()`,
   `appendEntry()`, `setSessionName()`, `getSessionName()`, `setLabel()`, `exec()`,
   `getActiveTools()`, `getAllTools()`, `setActiveTools()`, `getCommands()`, `setModel()`,
   `getThinkingLevel()`, `setThinkingLevel()`, `registerProvider()`, `unregisterProvider()`.

---

## Patch 6 — Extension error stack traces (minor)

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

## Patch 7 — Configurable `CONFIG_DIR_NAME` for project-local extensions (minor)

### Locate

The discovery path for project-local extensions:

```js
const localExtDir = path.join(cwd, ".pi", "extensions");
```

### Replace with

```js
const localExtDir = path.join(cwd, CONFIG_DIR_NAME, "extensions");
```

This requires importing `CONFIG_DIR_NAME` from `../../config.js` (already imported in 0.72.1).

---

## Regenerating the patch file

After applying all edits to `node_modules/@mariozechner/pi-coding-agent/`:

```bash
bunx patch-package @mariozechner/pi-coding-agent
```

This creates/updates `patches/@mariozechner+pi-coding-agent+0.72.1.patch`.

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
5. Launch app → extensions load successfully (check console for `Extensions loaded: N` with no errors)
6. Session reconnect works without `Cannot find module '@sinclair/typebox'`
