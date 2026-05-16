# Bug: electron-builder CI failure — `@smithy/*` resolution cascade

**Date:** 2026-05-17  
**Severity:** Build-breaking (CI release pipeline)  
**Environment:** GitHub Actions `windows-latest`, `bun install`, electron-builder 26.8.1  

## Symptom

CI release workflow (`release.yml`) fails at the `electron-builder --win --publish always` step with:

```
⨯ production dependency not found  parent=@smithy/util-buffer-from dependency=@smithy/core version=^3.24.3
⨯ Production dependency @smithy/core not found for package @smithy/util-buffer-from  failedTask=build
```

After fixing the first error, a cascade appeared:

```
⨯ production dependency not found  parent=@smithy/core dependency=@smithy/types version=^4.14.2
```

## Root Cause

**Two compounding issues:**

### 1. `bun.lock` was gitignored

`.gitignore` contained `bun.lock`, meaning CI ran `bun install` with no lockfile. This caused bun to resolve the **latest** versions of all transitive dependencies on every CI run — non-deterministic builds.

### 2. ALL `@smithy/*` resolution pins were stale

The `resolutions` field in `package.json` pinned `@smithy/*` packages to old versions. The `@smithy` ecosystem released a coordinated batch of updates where many packages added `@smithy/core@^3.24.3` as a new dependency and bumped their peer dependency ranges:

| Package | Old Pin | Latest | Key Change |
|---------|---------|--------|------------|
| `@smithy/core` | 3.23.17 | 3.24.3 | New baseline — needs `@smithy/types@^4.14.2` |
| `@smithy/types` | 4.14.1 | 4.14.2 | Required by `@smithy/core@^3.24.3` |
| `@smithy/protocol-http` | 5.3.14 | 5.4.3 | Now requires `@smithy/core@^3.24.3` |
| `@smithy/property-provider` | 4.2.14 | 4.3.3 | Now requires `@smithy/core@^3.24.3` |
| `@smithy/shared-ini-file-loader` | 4.4.9 | 4.5.3 | Now requires `@smithy/core@^3.24.3` |
| `@smithy/node-config-provider` | 4.3.14 | 4.4.3 | Now requires `@smithy/core@^3.24.3` |
| `@smithy/smithy-client` | 4.12.13 | 4.13.3 | Now requires `@smithy/core@^3.24.3` |
| `@smithy/util-middleware` | 4.2.14 | 4.3.3 | Now requires `@smithy/core@^3.24.3` |
| `@smithy/util-utf8` | 4.2.2 | 4.3.3 | Now requires `@smithy/core@^3.24.3` |
| `@aws-sdk/core` | 3.974.8 | 3.974.11 | — |
| `@aws-sdk/nested-clients` | 3.997.6 | 3.997.9 | — |

electron-builder's `traversalNodeModulesCollector` (used because bun lacks npm's dependency tree CLI) walks each package's declared dependencies and tries to locate them. When a resolution forces version X but a package declares `^Y` where X < Y, the collector fails with "production dependency not found."

## Why It Didn't Fail Locally

The local `node_modules` was installed at an earlier date when older versions were latest. CI re-resolved dependencies fresh and got newer incompatible versions.

## Fix Applied

### 1. Updated ALL `@smithy/*` and `@aws-sdk/*` resolutions to latest (`package.json`)

```diff
  "resolutions": {
-   "@smithy/types": "4.14.1",
-   "@smithy/protocol-http": "5.3.14",
-   "@smithy/property-provider": "4.2.14",
-   "@smithy/shared-ini-file-loader": "4.4.9",
-   "@smithy/node-config-provider": "4.3.14",
-   "@smithy/smithy-client": "4.12.13",
-   "@smithy/core": "3.23.17",
-   "@smithy/util-middleware": "4.2.14",
-   "@smithy/util-utf8": "4.2.2",
-   "@aws-sdk/types": "3.973.8",
-   "@aws-sdk/core": "3.974.8",
-   "@aws-sdk/nested-clients": "3.997.6"
+   "@smithy/types": "4.14.2",
+   "@smithy/protocol-http": "5.4.3",
+   "@smithy/property-provider": "4.3.3",
+   "@smithy/shared-ini-file-loader": "4.5.3",
+   "@smithy/node-config-provider": "4.4.3",
+   "@smithy/smithy-client": "4.13.3",
+   "@smithy/core": "3.24.3",
+   "@smithy/util-middleware": "4.3.3",
+   "@smithy/util-utf8": "4.3.3",
+   "@aws-sdk/types": "3.973.8",
+   "@aws-sdk/core": "3.974.11",
+   "@aws-sdk/nested-clients": "3.997.9"
  }
```

### 2. Committed `bun.lock` (removed from `.gitignore`)

```diff
- bun.lock
+ # bun.lock — committed to ensure reproducible CI builds (see docs/bugs/)
```

### 3. Updated CI workflow to use `--frozen-lockfile` (`release.yml`)

```diff
- run: bun install
+ run: bun install --frozen-lockfile
```

## Prevention

- Always commit lockfiles (`bun.lock`) for reproducible builds
- Use `--frozen-lockfile` in CI to detect drift
- When updating `resolutions`, update ALL related `@smithy/*` pins together — they release as a coordinated batch
- Consider running `bun run package:local` as a CI pre-check to catch electron-builder issues before release
