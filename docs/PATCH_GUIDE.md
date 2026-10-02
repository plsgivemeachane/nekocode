# SDK Patch Guide: `@earendil-works/pi-coding-agent`

> **Target version:** `0.99.2`
> **Patch file:** `patches/@earendil-works+pi-coding-agent+0.99.2.patch`
> **Purpose:** Recreate the patch-package diff from this document alone.  
> **Bug references:** `docs/bugs/extension-typebox-resolve-failure.md`, `docs/bugs/pi-extension-load-failure-bug.md`, `docs/bugs/extension-load-pi-agent-core-resolution-bug.md`

---

## Overview

NekoCode bundles the Pi SDK (`@earendil-works/pi-coding-agent`) into a worker ESM file via esbuild.
At `0.99.2`, upstream has added lazy jiti loading and embedded/source resolution branches. Keep
those branches intact and apply only the equivalent fixes below where the installed loader still
has the documented failure. The remaining failures do not occur when the SDK runs normally from
`node_modules/`.
The patches below fix those failures by modifying the SDK's **dist** files in `node_modules/` before
`patch-package` captures the diff.

The extension fixes target `dist/core/extensions/loader.js`. Pi 0.99.2 also
requires the credential compatibility exports in `dist/index.js` and
`dist/index.d.ts` described at the end of this guide.
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

`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`

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
(`@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`,
`@earendil-works/pi-ai/oauth`). When the workspace path doesn't exist on disk (production worker),
the function falls through to `import.meta.resolve(specifier)`, which throws `ERR_MODULE_NOT_FOUND`
because `node_modules/` doesn't exist adjacent to the bundled worker.

This crash happens **before** jiti is created, so `VIRTUAL_MODULES` (which already has the correct
mappings) is never reached. All 19 extensions fail identically.

### File

Same file: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`

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

Same file: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`

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

## Patch 4 — Provide `virtualModules` for the bundled worker

### Problem

Pi 0.99.2 now selects `resolutionOptions` for embedded, TypeScript-source, and normal Node
runtimes. NekoCode's bundled Node worker still needs the embedded module table even when the
upstream branch selected aliases; otherwise jiti falls back to filesystem resolution.

### File

Same file: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`

### Locate

Inside `loadExtensionModule`, locate the upstream jiti creation:

```js
const jiti = createJitiImpl(import.meta.url, {
    moduleCache: false,
    ...resolutionOptions,
});
```

### Replace with

```js
const jiti = createJitiImpl(import.meta.url, {
    moduleCache: false,
    ...resolutionOptions,
    // Always provide virtualModules so core packages resolve deterministically.
    // NekoCode also bundles the SDK in Node workers: always use embedded dependencies.
    virtualModules: await getVirtualModules(),
    tryNative: false,
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

## Patch 6 — `@aws-crypto` dependency version range fix (electron-builder)

**Bug:** `docs/bugs/aws-crypto-smithy-version-mismatch.md`

### Problem

electron-builder's `traversalNodeModulesCollector` (used when Bun is the package manager) reads
each `package.json` in `node_modules` and performs strict semver checks on declared dependencies.
`@aws-crypto/util@5.2.0` and `@aws-crypto/sha256-browser@5.2.0` declare `@smithy/util-utf8: "^2.0.0"`,
but the project's `resolutions` field forces `@smithy/util-utf8` to `4.2.2`. Since `4.2.2` does not
satisfy `^2.0.0` (major version mismatch), electron-builder throws:

```
⨯ Production dependency @smithy/util-utf8 not found for package @aws-crypto/util
```

The packages are API-compatible at runtime — this is purely a stale version range in the `@aws-crypto`
packages (a known AWS SDK ecosystem issue where the crypto helpers haven't been updated for `@smithy@4.x`).

### Files

- `node_modules/@aws-crypto/util/package.json`
- `node_modules/@aws-crypto/sha256-browser/package.json`

### Locate

In both files, find the `@smithy/util-utf8` dependency:

```json
"@smithy/util-utf8": "^2.0.0",
```

### Replace with

Widen the range to accept any version `>=2.0.0`:

```json
"@smithy/util-utf8": ">=2.0.0",
```

### When to regenerate

These patches are **independent of the Pi SDK version**. They only need regeneration if:

- `@aws-crypto/util` or `@aws-crypto/sha256-browser` change version (currently `5.2.0`)
- The `@smithy/util-utf8` resolution changes in `package.json` `resolutions`
- The `@aws-sdk/client-bedrock-runtime` version changes and pulls in different `@aws-crypto` versions

After editing, regenerate with:

```bash
# Generate via temp git repo (patch-package has issues with Bun + scoped packages on Windows)
# See: docs/bugs/aws-crypto-smithy-version-mismatch.md for the full procedure
```

---

## Patch 7 — `@aws-sdk/*` resolution pin updates (electron-builder)

**Bug:** `docs/bugs/smithy-core-version-pin-ci-failure.md` (recurrence section)

### Problem

After upgrading the Pi SDK, electron-builder's `traversalNodeModulesCollector` fails with
`Production dependency not found` because `@aws-sdk/*` packages in `resolutions` are pinned to
versions older than what the newly-pulled transitive dependencies declare in their `package.json`.

This is an **ongoing maintenance obligation** — every Pi SDK upgrade may pull newer `@aws-sdk/*`
transitive versions that bump their `^` ranges past existing pins.

### Diagnosis

Run this to find all stale pins:

```bash
# Scan node_modules for packages whose declared dependency ranges
# are not satisfied by the pinned resolution version.
node -e "
const fs = require('fs');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const resolutions = pkg.resolutions || {};

function checkPkg(pkgDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    for (const [dep, range] of Object.entries(p.dependencies || {})) {
      if (!resolutions[dep]) continue;
      const resVersion = resolutions[dep];
      const match = range.match(/^[\^~>=<]*(\d+)\.(\d+)\.(\d+)/);
      if (!match) continue;
      const [, rMaj, rMin, rPat] = match.map(Number);
      const [, vMaj, vMin, vPat] = resVersion.match(/^(\d+)\.(\d+)\.(\d+)/).map(Number);
      let satisfied = false;
      if (range.startsWith('^'))
        satisfied = vMaj === rMaj && (vMin > rMin || (vMin === rMin && vPat >= rPat));
      else if (range.startsWith('~'))
        satisfied = vMaj === rMaj && vMin === rMin && vPat >= rPat;
      else if (range.startsWith('>='))
        satisfied = vMaj > rMaj || (vMaj === rMaj && (vMin > rMin || (vMin === rMin && vPat >= rPat)));
      if (!satisfied)
        console.log(p.name + '@' + p.version + ' -> ' + dep + ': ' + range + ' (pinned: ' + resVersion + ')');
    }
  } catch {}
}

for (const d of fs.readdirSync('node_modules')) {
  if (d.startsWith('.')) continue;
  if (d.startsWith('@')) {
    for (const s of fs.readdirSync(path.join('node_modules', d)))
      checkPkg(path.join('node_modules', d, s));
  } else {
    checkPkg(path.join('node_modules', d));
  }
}
"
```

### Fix

Update the stale pins in `package.json` `resolutions` to the latest versions. Check latest with:

```bash
# Resolve versions with Bun, then inspect the installed package metadata.
bun install
node -e "for (const n of ['@aws-sdk/core','@aws-sdk/nested-clients','@aws-sdk/types']) console.log(n, require('./node_modules/'+n+'/package.json').version)"
```

### Recurrence history

| Date | Stale Pin | Required By | Old → New |
|------|-----------|-------------|-----------|
| 2026-05-17 | `@smithy/core` | `@smithy/util-buffer-from` + 8 others | `3.23.17` → `3.24.3` |
| 2026-05-17 | `@aws-sdk/core` | `@aws-sdk/client-bedrock-runtime` | `3.974.8` → `3.974.11` |
| 2026-05-17 | `@aws-sdk/nested-clients` | `@aws-sdk/credential-provider-*` | `3.997.6` → `3.997.9` |
| 2026-05-19 | `@aws-sdk/core` | `@aws-sdk/client-bedrock-runtime@3.1049.0` | `3.974.11` → `3.974.12` |
| 2026-05-19 | `@aws-sdk/nested-clients` | `@aws-sdk/credential-provider-login@3.972.42` + 4 others | `3.997.9` → `3.997.10` |

---

## Regenerating the patch file

After copying the pristine package into a temporary Git repository, apply all edits there:

```bash
tmp_dir=$(mktemp -d)
git -C "$tmp_dir" init
mkdir -p "$tmp_dir/node_modules/@earendil-works"
cp -a node_modules/@earendil-works/pi-coding-agent \
  "$tmp_dir/node_modules/@earendil-works/"
git -C "$tmp_dir" add node_modules
git -C "$tmp_dir" -c user.name=patch -c user.email=patch@example.invalid commit -m pristine
# Apply the edits above under "$tmp_dir/node_modules/...", then:
git -C "$tmp_dir" diff -- node_modules/@earendil-works/pi-coding-agent \
  > patches/@earendil-works+pi-coding-agent+0.99.2.patch
rm -rf "$tmp_dir"
```

This creates/updates `patches/@earendil-works+pi-coding-agent+0.99.2.patch`. Do not generate an
`npm` lockfile; keep `bun.lock` and regenerate it only with `bun install` after manifest changes.

> **Important:** Delete `.map` files from the patch if they bloat the diff. Source maps are not
> needed at runtime and can be regenerated. The patch file should ideally contain only `.js` and
> `.d.ts` changes.

---

## Verification checklist

After patching:

1. `bun run build:worker` — worker builds without errors
2. `bun run test` — all tests pass
3. `bun run lint` — no lint errors
4. `bun run type-check` — type check passes
5. Run the diagnosis script from Patch 7 above — no stale `@aws-sdk/*` resolution pins
6. `bun run package:local` — electron-builder packages successfully (validates `@aws-crypto` patches AND resolution pins)
7. Launch app -> extensions load successfully (check console for `Extensions loaded: N` with no errors)
8. Session reconnect works without `Cannot find module 'typebox'` or `Cannot find package '@earendil-works/pi-agent-core'`

## Pi 0.99.2 credential compatibility exports

Upstream still implements `AuthStorage`, `FileAuthStorageBackend`, and
`AuthStorageBackend` in `dist/core/auth-storage.*`, but no longer exports them
from its root. NekoCode's patch restores the first two value exports in
`dist/index.js` and `dist/index.d.ts`, plus the backend type export in
`dist/index.d.ts`. This lets the existing encrypted backend retain upstream's
command/environment key resolution, concurrent locking, and cancellation
behavior rather than implementing a separate file credential store.

```js
export { AuthStorage, FileAuthStorageBackend } from "./core/auth-storage.js";
```

```ts
export type { AuthStorageBackend } from "./core/auth-storage.js";
```

Include these pristine entrypoint files alongside the loader when generating
this version's temporary Git diff. Session model APIs still migrate to the
new `ModelRuntime` and public `CredentialStore` contract.

For 0.99.2, the AWS crypto patches are preserved in `docs/patches/archive/`;
these packages no longer occur in `bun.lock`. Only the Pi patch is active.
