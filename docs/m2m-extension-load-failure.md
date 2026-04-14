# M2M Headless Pipeline Extension Load Failure

> **Status:** Documented phenomenon
> **Affected:** Pi coding agent in headless M2M mode
> **Pi Version:** 0.66.1

---

## 1. Phenomenon

### Failing Extensions (full list)

| # | Extension Path | Type |
|---|----------------|------|
| 0 | `C:\Users\admin\.pi\agent\git\github.com\aliou\pi-extension-dev\src\index.ts` | Local git |
| 1 | `C:\Users\admin\AppData\Roaming\npm\node_modules\@marcfargas\pi-powershell\src\index.ts` | npm package |
| 2-3 | `pi-context/src/index.ts`, `pi-context/src/context.ts` | npm package |
| 4 | `pi-ask-user/index.ts` | npm package |
| 5 | `@plannotator\pi-extension` | npm package (index) |
| 6-7 | `lsp-pi/lsp.ts`, `lsp-pi/lsp-tool.ts` | npm package |
| 8-17 | `auto-session-name.ts`, `auto-update.ts`, `compact-header.ts`, `custom-footer.ts`, `file-skeleton.ts`, `git-guard.ts`, `pi-repomap/index.ts`, `pi-shell/index.ts`, `read.ts`, `tool-counter-widget.ts` | Local extensions |

### Notable: Zero Per-Extension Variation

Every extension produces the identical `"Failed to load extension: (void 0) is not a function"` message. There is no variation in the error text despite extensions having:

- Different import patterns (some use value imports, others only type imports)
- Different API usage (some register tools, others only bind event handlers)
- Different dependency trees (local vs npm packages)

This uniformity is the primary signal that the bug is **systemic**, not per-extension.

---

## 2. What This Is NOT

### Not a Per-Extension Bug

Verified by examining multiple extensions:

- All use the standard `export default function(pi: ExtensionAPI) { ... }` pattern
- `auto-session-name.ts` has **only type imports** and minimal code (just `pi.on()` calls) yet still fails
- If the issue were a missing export (e.g., `ExtensionCommandContext` removed in 0.65.0), only the extensions importing it would fail

### Not a Pi 0.65.0 Breaking Change (Directly)

Pi 0.65.0 introduced breaking changes (removed `session_switch`/`session_fork` events, `session_directory` API, added `AgentSessionRuntime`). However:

- The TUI handles these changes correctly with the same extensions
- Extensions updated for 0.65.0 use `session_start` with `event.reason` and work in TUI
- The error is not "event not found" or "API not found" but `(void 0) is not a function`

### Not a jiti Version Mismatch

- `@mariozechner/jiti` v2.6.5 installed (package.json expects `^2.6.2`)
- Within semver range

---

## 3. Code Path Analysis

### 3.1 Extension Loading Pipeline (Shared by Both Modes)

    createRuntime()                                    [main.js:410]
      -> createAgentSessionServices()                  [agent-session-services.js:53]
        -> new DefaultResourceLoader({...})            [resource-loader.js:208]
        -> resourceLoader.reload()                      [resource-loader.js:258]
          -> packageManager.resolve()                  [resource-loader.js:280]
          -> loadExtensions(paths, cwd, eventBus)      [loader.js:284]
            -> createExtensionRuntime()                [loader.js:287]
            -> for each path:
              -> loadExtension(path, cwd, bus, runtime) [loader.js:255]
                -> loadExtensionModule(path)           [loader.js:223]
                  -> createJiti(import.meta.url, opts) [loader.js:230]
                  -> jiti.import(path, {default:true}) [loader.js:237]
                  -> typeof factory !== "function"
                     ? return undefined
                     : return factory
                -> createExtensionAPI(ext, runtime, cwd, bus) [loader.js:92]
                -> factory(api)                          [loader.js:265]
                  *** ERROR THROWN HERE ***
                -> catch: "Failed to load extension: " + err.message [loader.js:269]

### 3.2 TUI Reconnect Path (Works)

    AgentSessionRuntime.switchSession()               [agent-session-runtime.js:88]
      -> teardownCurrent()                             [agent-session-runtime.js:73]
      -> createRuntime()                               (same pipeline as 3.1)
      -> apply(result)                                 [agent-session-runtime.js:78]
    TUI.bindExtensions()                               [TUI code]
      -> session.bindExtensions({uiContext, ...})      [agent-session.js:1596]
        -> _applyExtensionBindings(runner)             (applies UI context)
        -> runner.emit(sessionStartEvent)              (emits event, no re-loading)

### 3.3 RPC/M2M Reconnect Path

    runtimeHost.switchSession(sessionPath)             [agent-session-runtime.js:88]
      -> (same as TUI: teardownCurrent + createRuntime + apply)
    rebindSession()                                    [rpc-mode.js:207]
      -> session = runtimeHost.session
      -> session.bindExtensions({                      [agent-session.js:1596]
           uiContext: createExtensionUIContext(),
           commandContextActions: {...},
           onError: (err) => output(...)
         })
      -> session.subscribe(event => output(event))

### 3.4 Critical Observation

The `bindExtensions()` path in both TUI and RPC mode does **NOT** re-run `loadExtensions()`. It only applies UI context and emits the `session_start` event to already-loaded extensions.

The error `"Failed to load extension: (void 0) is not a function"` comes **exclusively** from `loader.js:loadExtension()` (the catch block at line 269). This means the M2M pipeline must be triggering a code path that re-runs the full extension loader, which the standard TUI and RPC reconnect paths do NOT do.

---

## 4. The `(void 0) is not a function` Signature

### Why This Specific Phrasing Matters

In V8 (Node.js), calling `undefined()` produces:

    TypeError: undefined is not a function

But the error in the log is `(void 0) is not a function` (no `TypeError:` prefix, `void 0` instead of `undefined`). This has two implications:

1. **`void 0` is the minified form of `undefined`** — The error originates from **bundled/minified code**, not from the extension source files (which are plain, unminified TypeScript loaded by jiti)

2. **The `TypeError:` prefix is stripped** by the catch block in loader.js:269, which uses `err.message` (not `err.toString()`)

### Where Minified Code Exists in the Chain

The extensions themselves are NOT minified. But their dependencies resolve to minified dist files:

- `@mariozechner/pi-ai/dist/index.js` — bundled, minified
- `@mariozechner/pi-tui/dist/index.js` — bundled, minified
- `@mariozechner/jiti/dist/jiti.cjs` — webpack-bundled, minified
- `@mariozechner/pi-coding-agent/dist/*.js` — bundled, minified

When jiti resolves an extension's `import { Type } from "@mariozechner/pi-ai"`, it loads the **minified** dist file. If that module initialization throws, the error message carries the minified `void 0` form.

### Why It Affects ALL Extensions

Despite different import patterns, all extensions share a common dependency resolution chain through jiti:

- All go through `createJiti(import.meta.url, { alias: getAliases() })`
- All use the same **cached** alias map (`_aliases` in loader.js:43)
- If the alias map resolves to a broken path, every extension that transitively depends on the broken module fails

---

## 5. Root Cause Hypothesis

### Primary: Stale Alias Cache + Process Context Difference

The `getAliases()` function in `loader.js:43` builds a module alias map **once** and caches it permanently in `_aliases`:

    let _aliases = null;
    function getAliases() {
        if (_aliases) return _aliases;  // Returns cached on second call
        // ... builds alias map using import.meta.resolve() and require.resolve() ...
        _aliases = { ... };
        return _aliases;
    }

These aliases map package specifiers to on-disk paths:

    "@mariozechner/pi-ai" -> "C:/Users/admin/.../node_modules/@mariozechner/pi-ai"
    "@mariozechner/pi-tui" -> "C:/Users/admin/.../node_modules/@mariozechner/pi-tui"

**Hypothesis:** The M2M pipeline starts pi in a process context where `import.meta.resolve()` or `require.resolve()` (used inside `getAliases()`) resolves to different paths than the TUI context. Possible causes:

- Different `process.cwd()` at process start time
- Different `NODE_PATH` environment variable
- Different `node_modules` resolution hierarchy (e.g., running from a project dir that has its own `@mariozechner/pi-ai` in its node_modules)
- Symlink/junction differences between TUI launch and M2M pipeline launch

On first startup, `getAliases()` builds the map (possibly with wrong paths for the M2M context). On reconnect (which may spawn a new process or re-initialize), the **cached** aliases are used — but they point to paths that are now invalid or resolve to different module versions.

### Secondary: M2M Pipeline Triggers Non-Standard Reload Path

The standard TUI and RPC reconnect paths do NOT re-run `loadExtensions()`. The M2M pipeline's `[session-manager]` log indicates it does. Possible mechanisms:

1. **Process restart on reconnect** — The M2M pipeline kills and restarts the pi process, passing `--resume <session>`. This triggers a fresh `createRuntime()` → `loadExtensions()`, but in a new process with potentially different environment
2. **Direct `createRuntime()` invocation** — The M2M pipeline may call pi's internal API to create a new runtime, bypassing the normal `switchSession()` flow
3. **Separate extension loading wrapper** — The M2M pipeline may import `loadExtensions` from loader.js directly and invoke it with incorrect parameters

### Why `auto-session-name.ts` Fails Despite Having Only Type Imports

This extension has:

    import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
    export default function(pi: ExtensionAPI) {
      pi.on("session_start", async (_event, ctx) => { ... });
    }

No runtime imports. No dependency on external packages. Yet it fails with the same error.

**Possible explanation:** jiti's TypeScript transpilation step itself fails. If jiti internally uses a module that resolves incorrectly via the stale aliases, the transpilation of ANY extension file could throw during `jiti.import()`, before the extension code even executes.

---

## 6. Diagnostic Steps

### 6.1 Capture the Full Stack Trace

The current error handling in `loader.js:269` discards the stack trace:

    // Current (unhelpful)
    const message = err instanceof Error ? err.message : String(err);
    return { extension: null, error: `Failed to load extension: ${message}` };

**Fix:** Include `err.stack`:

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    return { extension: null, error: `Failed to load extension: ${message}`, stack };

The stack trace will reveal the **exact file and line** where `(void 0) is not a function` originates — distinguishing between jiti internals, a dependency's minified code, or the extension itself.

### 6.2 Log Alias Resolution

Add temporary logging to `getAliases()` in `loader.js:43`:

    function getAliases() {
        if (_aliases) {
            console.log("[ALIASES] Returning cached:", JSON.stringify(_aliases));
            return _aliases;
        }
        // ... build aliases ...
        console.log("[ALIASES] Built new:", JSON.stringify(_aliases));
        return _aliases;
    }

Compare the alias paths between TUI startup and M2M reconnect. Any difference confirms the hypothesis.

### 6.3 Compare Process Environments

At the start of `loadExtensions()` (loader.js:284), log:

    console.log("[LOAD-EXT] cwd:", process.cwd());
    console.log("[LOAD-EXT] NODE_PATH:", process.env.NODE_PATH);
    console.log("[LOAD-EXT] __dirname:", __dirname);
    console.log("[LOAD-EXT] import.meta.url:", import.meta.url);

### 6.4 Test jiti.import in Isolation

Create a standalone test script that mimics what the loader does:

    import { createJiti } from "@mariozechner/jiti";
    const jiti = createJiti(import.meta.url, { moduleCache: false, alias: getAliases() });
    try {
        const mod = await jiti.import("C:/Users/admin/.pi/agent/extensions/auto-session-name.ts", { default: true });
        console.log("Type:", typeof mod);
    } catch (e) {
        console.log("Error:", e.message);
        console.log("Stack:", e.stack);
    }

Run this from both the TUI context and the M2M pipeline context.

### 6.5 Determine the M2M Reconnect Mechanism

Add logging to identify which code path triggers the reload:

- Log at the start of `loadExtensions()` (loader.js:284) — if this fires on reconnect, the M2M pipeline is re-running the full loader
- Log at the start of `bindExtensions()` (agent-session.js:1596) — if only this fires, the extensions are already loaded and the error is from the `emit()` call
- Search the M2M pipeline code for calls to `loadExtensions`, `ResourceLoader`, or `createRuntime`

---

## 7. Recommended Fixes

### 7.1 Pi Core (loader.js)

**Invalidate alias cache on cwd change:**

    let _aliasesCwd = null;
    function getAliases() {
        const currentCwd = process.cwd();
        if (_aliases && _aliasesCwd === currentCwd) return _aliases;
        _aliasesCwd = currentCwd;
        // ... build aliases ...
        return _aliases;
    }

**Include stack traces in extension load errors:**

    return {
        extension: null,
        error: `Failed to load extension: ${message}`,
        stack: err instanceof Error ? err.stack : undefined
    };

**Validate cached alias paths exist before use:**

    function getAliases() {
        if (_aliases) {
            for (const [pkg, path] of Object.entries(_aliases)) {
                if (!fs.existsSync(path)) {
                    console.warn(`[ALIASES] Stale path for ${pkg}: ${path}, rebuilding`);
                    _aliases = null;
                    break;
                }
            }
        }
        if (!_aliases) { /* rebuild */ }
        return _aliases;
    }

### 7.2 M2M Pipeline

**Ensure process environment parity:** The pi subprocess started by the M2M pipeline must have the same `cwd`, `NODE_PATH`, and module resolution context as the TUI launch.

**Avoid unnecessary extension reloading:** If the M2M pipeline triggers `loadExtensions()` on reconnect when `bindExtensions()` would suffice, fix the reconnect path to use `bindExtensions()` instead.

**Pass extension load errors through with full context:** The M2M pipeline's `[session-manager]` error log should include the stack trace, not just the error message.

### 7.3 Extension Authors

**Use `import type` for type-only imports:**

    // Bad (value import — resolved at runtime by jiti)
    import { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

    // Good (erased at transpilation time)
    import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

Note: This is a defensive measure only — it does not fix the systemic issue since extensions with only type imports (like `auto-session-name.ts`) also fail.

---

## 8. Related Pi Issues

| Issue | Relevance |
|-------|-----------|
| #2835 — tools flag should filter extension tools | Directly affects spawning child pi processes with extensions |
| #1629 — Concurrent pi processes crash on startup | Lock contention when M2M pipeline spawns/restarts pi processes |
| #2714 — RFC: Agent Event Bus Pi Extension | Cross-session coordination needed for M2M multi-agent setups |
| #2715 — RFC: Agent Event Bus integration as extension | Same as above, extension-based approach |
| #2766 (0.65.0) — Fixed startup resource loading | Fixed double-loading on first runtime; may have introduced the reconnect regression |

---

## 9. Summary

The `(void 0) is not a function` error during M2M reconnect is a **systemic module resolution failure**, not a per-extension bug. The evidence points to:

1. A **stale or incorrect alias cache** in pi's extension loader that resolves dependency paths differently in the M2M process context
2. The M2M pipeline triggering a **non-standard reload path** that re-runs the full extension loader (which the TUI's reconnect does not do)
3. The error originating from **minified dependency code** (not extension source), suggesting a broken module in the resolution chain

Confirmation requires runtime debugging (stack traces + alias path logging) from within the M2M pipeline's reconnect path.


All 18 extensions fail during session reconnect with identical error.

    2026-04-04 21:04:13 [session-manager] error: [reconnect] Extension load errors (18): {"0":{"path":"C:\Users\admin\.pi\agent\git\github.com\aliou\pi-extension-dev\src\index.ts","error":"Failed to load extension: (void 0) is not a function"},"1":{"path":"C:\Users\admin\AppData\Roaming\npm\node_modules\@marcfargas\pi-powershell\src\index.ts","error":"Failed to load extension: (void 0) is not a function"}, ...}

Key characteristics:

- **All 18 extensions** fail with the **exact same error message**
- The TUI/interactive terminal loads the same extensions **without error**
- The error only manifests during **reconnect** in the M2M pipeline
- The error string `(void 0) is not a function` is the **minified V8 form** of `undefined is not a function`
- The `[session-manager]` and `[reconnect]` log tags originate from the **external M2M pipeline**, not from pi itself

---

## 10. NekoCode Local Resolution (April 14, 2026)

This repository now ships a local dependency patch via `patch-package` for `@mariozechner/pi-coding-agent@0.64.0`:

- Patch file: `patches/@mariozechner+pi-coding-agent+0.64.0.patch`
- Applied automatically by `postinstall` in `package.json`

### What the local patch changes

1. `getAliases()` no longer hard-depends on `import.meta.resolve`; it uses `import.meta.resolve` only when available and falls back safely otherwise.
2. `resolveWorkspaceOrImport(...)` now has deterministic fallback dist paths for sibling packages before package resolution:
    - `@mariozechner/pi-agent-core` -> `.../pi-agent-core/dist/index.js`
    - `@mariozechner/pi-tui` -> `.../pi-tui/dist/index.js`
    - `@mariozechner/pi-ai` -> `.../pi-ai/dist/index.js`
    - `@mariozechner/pi-ai/oauth` -> `.../pi-ai/dist/oauth.js`
3. Alias map construction no longer crashes on package export restrictions; `require.resolve(specifier)` is wrapped, and last-resort fallback returns the specifier instead of throwing.
4. Alias cache is keyed by runtime context (`cwd` + `NODE_PATH`) to avoid stale resolver state reuse.
5. Extension load errors now include stack traces to make root-cause analysis actionable.
6. jiti is configured with `virtualModules` and `tryNative: false` for consistent resolver behavior.

### Why this fixes the reported reconnect crash

Your failing stack pointed to `resolveWorkspaceOrImport` -> `getAliases` with `ERR_PACKAGE_PATH_NOT_EXPORTED` while resolving `@mariozechner/pi-ai`. The local patch removes that failure path by:

1. Avoiding unconditional `import.meta.resolve` calls.
2. Trying explicit sibling-package dist file fallbacks first.
3. Preventing alias-map build from throwing when package exports block direct resolution.

### App-side hardening in this repo

1. `create()` and `reconnect()` now use shared session bootstrap logic.
2. Systemic extension loader failures can hard-fail by default (fallback is opt-in via `NEKOCODE_ALLOW_EXTENSION_FALLBACK=1`).

### Current expected behavior

- If SDK extension loading succeeds: normal mode.
- If systemic extension loading fails and fallback env var is disabled: explicit hard failure with diagnostics.
- If fallback env var is enabled: degraded mode with extensions disabled for that session.

### Cleanup status in this repo

1. No tool-level filtering/blocklist is applied in `PiSessionManager`; extension/tool availability is now controlled by SDK/runtime only.
2. No local references to `create_reservation` or `correctconvo` remain under `src/` or `docs/`.

### Verification snapshot

- Targeted tests pass after cleanup:
    - `src/tests/session-manager.test.ts`
    - `src/tests/ipc-handlers.test.ts`
