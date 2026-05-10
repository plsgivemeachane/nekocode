# Bug: `@aws-crypto/util` and `@aws-crypto/sha256-browser` — `@smithy/util-utf8` Version Mismatch Causes electron-builder Build Failure

## Summary

`bun run package:local` fails during electron-builder's node module traversal with:

```
⨯ Production dependency @smithy/util-utf8 not found for package @aws-crypto/util
```

Root cause: `@aws-crypto/util@5.2.0` and `@aws-crypto/sha256-browser@5.2.0` declare a dependency on `@smithy/util-utf8@^2.0.0` (i.e. `>=2.0.0 <3.0.0`), but the project's `resolutions` field forces `@smithy/util-utf8` to `4.2.2`. Bun's flat `node_modules` hoists `4.2.2` to the root, which works at runtime but fails during electron-builder's static dependency traversal because `4.2.2` does not satisfy `^2.0.0`.

---

## 1. The Fracture Point

- **File:** `node_modules/@aws-crypto/util/package.json` (line 25) and `node_modules/@aws-crypto/sha256-browser/package.json` (line 26)
- **Function:** electron-builder `traversalNodeModulesCollector.ts` → `buildPackage()` → `buildFromPackage()`
- **Error:** `Production dependency @smithy/util-utf8 not found for package @aws-crypto/util`

## 2. The Evidence

### Dependency chain
```
@earendil-works/pi-coding-agent@0.74.0
  → @earendil-works/pi-ai@0.74.0
    → @aws-sdk/client-bedrock-runtime@3.1045.0
      → @aws-crypto/sha256-browser@5.2.0  ← declares @smithy/util-utf8: "^2.0.0"
        → @aws-crypto/util@5.2.0          ← declares @smithy/util-utf8: "^2.0.0"
```

### Version conflict
- `@aws-crypto/util@5.2.0` requires `@smithy/util-utf8@^2.0.0` (semver: `>=2.0.0 <3.0.0`)
- `@aws-crypto/sha256-browser@5.2.0` requires `@smithy/util-utf8@^2.0.0`
- Project `resolutions` pins `@smithy/util-utf8` to `4.2.2`
- `4.2.2` does NOT satisfy `^2.0.0` — major version mismatch (4 vs 2)

### npm ls confirmation
```
npm ls @smithy/util-utf8
  └─ @aws-crypto/util@5.2.0
       └── @smithy/util-utf8@4.2.2 deduped invalid: "^2.0.0"
```

### Why it works at runtime but fails at build time
- **Runtime (Bun):** Bun resolves `@smithy/util-utf8` from the hoisted root `node_modules/@smithy/util-utf8@4.2.2`. The `@aws-crypto` packages are API-compatible with v4.x — the version range is simply stale.
- **Build time (electron-builder):** `traversalNodeModulesCollector` reads each `package.json` in `node_modules`, checks declared dependency versions against installed versions using strict semver, and throws when `4.2.2` fails the `^2.0.0` check.

### Why this is a known AWS SDK ecosystem issue
The `@aws-crypto/*@5.2.0` packages haven't been updated to accept `@smithy@4.x`. The AWS SDK v3 (`@aws-sdk/client-bedrock-runtime@3.1045.0`) moved to `@smithy@4.x` but the `@aws-crypto` sub-packages still pin to `^2.0.0`. This is a version drift bug in the AWS SDK dependency tree.

## 3. Recommended Fix Strategy

### Applied fix: `patch-package` patches

Created two patch files that widen the `@smithy/util-utf8` version range from `^2.0.0` to `>=2.0.0`:

- `patches/@aws-crypto+util+5.2.0.patch` — patches `node_modules/@aws-crypto/util/package.json`
- `patches/@aws-crypto+sha256-browser+5.2.0.patch` — patches `node_modules/@aws-crypto/sha256-browser/package.json`

These patches are applied automatically during `bun install` via the `postinstall: "patch-package"` hook.

### Why `>=2.0.0` instead of `^2.0.0 || ^4.0.0`
Using `>=2.0.0` is simpler and future-proof. The `@aws-crypto` packages are API-compatible with `@smithy/util-utf8` across major versions — it's a simple UTF-8 encoding/decoding utility with a stable interface.

### What was also updated
- `scripts/verify-patches.cjs` — added checks for the two new `@aws-crypto` patch files to prevent silent build regression

### Notes on patch generation
`patch-package` on Windows can have issues generating patches for scoped packages with Bun's resolution. The patches were generated using a temporary git repo to produce clean unified diffs, then saved with the correct `patch-package` naming convention (`@scope+package+version.patch`). If regenerating, use:

```bash
# 1. Create temp git repo, copy the original package.json
# 2. Make the edit (^2.0.0 → >=2.0.0)
# 3. git diff to produce the unified diff
# 4. Save as patches/@aws-crypto+<package>+5.2.0.patch
#    with paths prefixed as node_modules/@aws-crypto/<package>/package.json
```

## 4. Files Changed

| File | Change |
|------|--------|
| `patches/@aws-crypto+util+5.2.0.patch` | **NEW** — widens `@smithy/util-utf8` range |
| `patches/@aws-crypto+sha256-browser+5.2.0.patch` | **NEW** — widens `@smithy/util-utf8` range |
| `scripts/verify-patches.cjs` | Added verification for the two new patch files |
