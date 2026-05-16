# Bug: electron-builder CI failure — `@smithy/core` version mismatch

**Date:** 2026-05-17  
**Severity:** Build-breaking (CI release pipeline)  
**Environment:** GitHub Actions `windows-latest`, `bun install`, electron-builder 26.8.1  

## Symptom

CI release workflow (`release.yml`) fails at the `electron-builder --win --publish always` step with:

```
⨯ production dependency not found  parent=@smithy/util-buffer-from dependency=@smithy/core version=^3.24.3
⨯ Production dependency @smithy/core not found for package @smithy/util-buffer-from  failedTask=build
```

## Root Cause

**Two compounding issues:**

### 1. `bun.lock` was gitignored

`.gitignore` contained `bun.lock`, meaning CI ran `bun install` with no lockfile. This caused bun to resolve the **latest** versions of all transitive dependencies on every CI run — non-deterministic builds.

### 2. `@smithy/core` resolution was stale

The `resolutions` field in `package.json` pinned `@smithy/core` to `3.23.17`. Meanwhile, the `@smithy` ecosystem published newer versions:

- `@smithy/util-buffer-from` **4.3.3+** added `@smithy/core@^3.24.3` as a dependency (4.2.2 did NOT have this dep)
- `@smithy/is-array-buffer` latest also depends on `@smithy/core@^3.24.3`
- All `@smithy/*` latest versions now require `@smithy/core@^3.24.3`

Since `3.23.17 < 3.24.3`, the pinned resolution did not satisfy the semver constraint `^3.24.3`. electron-builder's `traversalNodeModulesCollector` (used because bun lacks npm's dependency tree CLI) read `@smithy/util-buffer-from`'s `package.json`, found the `@smithy/core@^3.24.3` dependency, but could not resolve it — causing the fatal error.

## Why It Didn't Fail Locally

The local `node_modules` had `@smithy/util-buffer-from@4.2.2` (which does NOT depend on `@smithy/core`). The local install was done at an earlier date when 4.2.2 was the latest. CI re-resolved dependencies fresh and got 4.3.3+.

## Fix Applied

### 1. Updated `@smithy/core` resolution (`package.json`)

```diff
- "@smithy/core": "3.23.17",
+ "@smithy/core": "3.24.3",
```

### 2. Committed `bun.lock` (removed from `.gitignore`)

```diff
- bun.lock
+ # bun.lock — committed to ensure reproducible CI builds (see docs/bugs/)
```

This ensures CI installs the exact same dependency tree as local development.

### 3. Updated CI workflow to use `--frozen-lockfile` (`release.yml`)

```diff
- run: bun install
+ run: bun install --frozen-lockfile
```

This makes CI fail-fast if the lockfile is out of sync with `package.json`, rather than silently re-resolving.

## Prevention

- Always commit lockfiles (`bun.lock`) for reproducible builds
- Use `--frozen-lockfile` in CI to detect drift
- When updating `resolutions`, verify the pinned version satisfies all downstream semver ranges
- Consider running `bun run package:local` as a CI pre-check to catch electron-builder issues before release
