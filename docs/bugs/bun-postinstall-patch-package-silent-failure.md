# Bug: Bun's postinstall Hook Silently Fails to Run `patch-package`, Causing electron-builder Build Failure

## Summary

`bun run package:local` fails during electron-builder's node module traversal with:

```
⨯ Production dependency @smithy/util-utf8 not found for package @aws-crypto/util
```

Root cause: Bun's `postinstall` hook (`patch-package`) silently fails after `bun install`, leaving the `@aws-crypto` patches unapplied. The `verify:patches` script only checked that patch files **exist on disk** — it did not verify they were **applied in `node_modules`**.

---

## 1. The Fracture Point

- **File:** `node_modules/@aws-crypto/util/package.json`
- **Script:** `postinstall: "patch-package"` in `package.json`
- **Error:** `Production dependency @smithy/util-utf8 not found for package @aws-crypto/util`

## 2. The Evidence

### What happened
1. `bun install` ran and installed dependencies correctly.
2. Bun's `postinstall` hook (`patch-package`) was supposed to apply patches but **silently failed** (no error output, exit code 0).
3. `verify:patches` passed because it only checked that `patches/@aws-crypto+util+5.2.0.patch` **file exists** — it never checked if the patch was actually applied in `node_modules`.
4. electron-builder's `traversalNodeModulesCollector` read `@aws-crypto/util/package.json`, found `@smithy/util-utf8: "^2.0.0"`, and the installed version `4.2.2` failed the semver check.

### Manual fix confirmation
Running `bunx patch-package` manually before the build applied the patches and resolved the error:

```
$ bunx patch-package
patch-package 8.0.1
Applying patches...
@aws-crypto/sha256-browser@5.2.0 ✔
@aws-crypto/util@5.2.0 ✔
@earendil-works/pi-coding-agent@0.75.3 ✔
```

### Why Bun's postinstall can fail silently
- Bun's lifecycle hook execution differs from npm/yarn — hooks may not run in all environments or may fail without propagating errors.
- This is a known Bun ecosystem issue where `postinstall` scripts that work in npm can silently skip in Bun.

## 3. Applied Fix

### 1. Updated `verify:patches` to detect unapplied patches

Added a runtime check in `scripts/verify-patches.cjs` that reads `node_modules/@aws-crypto/util/package.json` and verifies `@smithy/util-utf8` is `>=2.0.0` (not `^2.0.0`). If the patch is unapplied, the script fails with a clear error message.

### 2. Added `bunx patch-package` to all build scripts

Every build/package script now runs `bunx patch-package` **before** `verify:patches`, ensuring patches are always applied regardless of whether `bun install`'s postinstall hook ran:

```json
"build": "bunx patch-package && bun run verify:patches && electron-vite build && ...",
"package": "... && bunx patch-package && bun run verify:patches && ...",
"package:local": "bunx patch-package && bun run verify:patches && ...",
"package:mac": "bunx patch-package && bun run verify:patches && ...",
"package:linux": "bunx patch-package && bun run verify:patches && ...",
"package:all": "... && bunx patch-package && bun run verify:patches && ...",
"release": "bunx patch-package && bun run verify:patches && ..."
```

`patch-package` is idempotent — re-running it when patches are already applied is a no-op.

### 3. Kept `postinstall` hook as-is

The `postinstall: "patch-package"` hook in `package.json` is kept for environments where Bun's postinstall does work (CI, fresh installs). The explicit `bunx patch-package` in build scripts acts as a safety net.

## 4. Files Changed

| File | Change |
|------|--------|
| `scripts/verify-patches.cjs` | Added runtime check that `@aws-crypto/util` patch is actually applied in `node_modules` |
| `package.json` | Added `bunx patch-package &&` before `verify:patches` in all build/package/release scripts |
