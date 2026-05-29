# Bug: Unhandled Error When Opening Non-Git Project in Git View

**Date:** 2025-05-29
**Status:** Fixed
**Severity:** Medium — Unhandled error shown to user, but app doesn't crash

---

## Description

When a user opens a project folder that is **not a Git repository** and switches to the Git view, the application throws an unhandled error:

```
Error invoking remote method 'git:branch-list': Error: Failed to list branches: fatal: not a git repository (or any of the parent directories): .git
```

This error is displayed as a raw, unfriendly message in the UI. The same issue affects all git operations (`getStatus`, `getLog`, `branchList`, `getDiff`, `getDiffSummary`, `stashList`) — they all throw errors when the project directory is not inside a git repository.

Only `getBranch()` and `getRemoteUrl()` gracefully handled this case by returning `null`.

## Root Cause

`GitOperationsManager` in `src/main/git-operations-manager.ts` did not have a way to detect whether a directory is a git repository. All read operations (except `getBranch` and `getRemoteUrl`) wrapped `simple-git` calls in try/catch but re-threw the error with a formatted message, which then propagated through the IPC layer to the renderer as an unhandled error.

The renderer's `useGitOperations` hook would then set this error in state and display it as-is to the user, with no context about why the error occurred (the directory simply isn't a git repo).

Additionally, the polling timer continued to fire git operations against non-git directories, generating repeated errors.

## Fix

### 1. Added `isGitRepo()` method to `GitOperationsManager` (main process)

New method that uses `simple-git`'s `checkIsRepo()` to determine if a directory is a git repository:

```typescript
async isGitRepo(cwd: string): Promise<boolean> {
  validateCwd(cwd)
  try {
    await git(cwd).checkIsRepo()
    return true
  } catch {
    return false
  }
}
```

### 2. Added graceful handling for non-git repos in all read operations

Each read method (`getStatus`, `getLog`, `branchList`, `getDiff`, `getDiffSummary`, `stashList`) now catches the `not a git repository` error specifically and returns an empty/default result instead of throwing:

```typescript
catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err)
  if (errMsg.includes('not a git repository')) {
    logger.debug(`branchList: ${cwd} is not a git repository`)
    return { branches: [], current: null }
  }
  // ... re-throw for other errors
}
```

### 3. Added `GIT_IS_REPO` IPC channel

- Added `GIT_IS_REPO: 'git:is-repo'` to `src/shared/ipc-channels.ts`
- Added `isRepo` method to `NekoCodeIPC.git` interface in `src/shared/ipc-types.ts`
- Added IPC handler in `src/main/ipc-handlers.ts`
- Added preload bridge in `src/preload/index.ts`

### 4. Updated `useGitOperations` hook (renderer)

- Added `isGitRepo` state (`boolean | null`) — `null` means not yet checked
- Added `isGitRepoRef` ref for the polling interval to read the latest value without re-triggering the effect
- On project change, calls `window.nekocode.git.isRepo()` first before attempting any git operations
- All refresh functions and mutation functions check `isGitRepo === false` and skip the operation
- Polling interval is only set up when `isGitRepo !== false`
- Returns `isGitRepo` in the hook result for consumers to use

### 5. Added "Not a Git Repository" UI in `GitCommandCenter`

When `isGitRepo === false`, the GitCommandCenter shows a friendly message:

```
This project is not a Git repository
Initialize a repository with `git init` to enable Git features
```

### 6. Updated test mocks

Added `isRepo: vi.fn().mockResolvedValue(true)` to the mock IPC in `src/tests/__utils__/test-utils.tsx` and updated the IPC channels test to include `GIT_IS_REPO`.

## Files Changed

| File | Change |
|------|--------|
| `src/main/git-operations-manager.ts` | Added `isGitRepo()` method; graceful handling for non-git repos in `getStatus`, `getLog`, `branchList`, `getDiff`, `getDiffSummary`, `stashList` |
| `src/shared/ipc-channels.ts` | Added `GIT_IS_REPO` channel |
| `src/shared/ipc-types.ts` | Added `isRepo` to `NekoCodeIPC.git` interface |
| `src/main/ipc-handlers.ts` | Added `GIT_IS_REPO` IPC handler |
| `src/preload/index.ts` | Added `isRepo` preload bridge |
| `src/renderer/src/hooks/useGitOperations.ts` | Added `isGitRepo` state/ref, pre-check before operations, skip polling for non-git repos, return `isGitRepo` |
| `src/renderer/src/components/git/GitCommandCenter.tsx` | Added "Not a Git Repository" UI |
| `src/tests/__utils__/test-utils.tsx` | Added `isRepo` mock |
| `src/tests/shared/ipc-channels.test.ts` | Updated channel count and key list for `GIT_IS_REPO` |

## Testing

- All 66 test files pass (1453 tests)
- Type check passes
- Lint passes
