# Bug: Unknown operation type: project:load-workspace

**Date:** 2026-05-29
**Severity:** High — causes UnhandledPromiseRejection, workspace never loads on startup
**Status:** Fixed

## Symptoms

On app startup, the following error appeared in the console/log:

```
[thread-queue] warn: Operation 092f7f86-... failed: Unknown operation type: project:load-workspace
UnhandledPromiseRejectionWarning: Error: Unknown operation type: project:load-workspace
    at ThreadOperationQueue.handleWorkerMessage (out/main/index.js:140814:30)
    at Worker.<anonymous> (out/main/index.js:140762:9)
```

The workspace would never load, meaning the app started with no projects restored from the previous session.

## Root Cause

The `ThreadedProjectManager.loadWorkspace()` method dispatches a `project:load-workspace` operation to the worker thread via `ThreadOperationQueue.execute()`. However, the worker's `dispatchOperation()` switch statement in `worker-bootstrap.ts` was **missing** the case for `project:load-workspace`.

The operation type `project:load-workspace` was already:
- Defined in `OperationType` union type in `types.ts`
- Had `ProjectLoadWorkspaceInput` and `ProjectLoadWorkspaceOutput` interfaces defined
- Was used by `ThreadedProjectManager.loadWorkspace()` to dispatch to the queue

But the worker's `dispatchOperation()` function had no handler for it, causing the `default` branch to throw `"Unknown operation type: project:load-workspace"`.

Additionally, the call to `projectManager.loadWorkspace()` in `index.ts` had no try/catch, causing the rejection to be unhandled.

## Architecture Gap

The original `ThreadedProjectManager.loadWorkspace()` dispatched the operation to the worker but then **discarded the result**. This was conceptually wrong because:

1. The worker reads `workspace.json` from disk and returns the parsed data (project paths, active session, etc.)
2. But the worker **cannot** apply that data to the main-thread `ProjectManager`'s in-memory state (`Map<string, Project>`)
3. So even if the worker handler existed, the workspace data would be lost — never applied to the project manager

## Fix

Three changes were required:

### 1. Add `handleProjectLoadWorkspace` to worker-bootstrap.ts

Added the worker-side handler that:
- Reads `workspace.json` from the given path
- Parses the JSON to extract `projectPaths`, `activeSessionId`, `activeProjectPath`
- Returns the data as `ProjectLoadWorkspaceOutput`
- Handles missing file (ENOENT) gracefully by returning empty state
- Handles corrupt/unreadable files by logging error and returning empty state

Also added the `case 'project:load-workspace':` to `dispatchOperation()`.

### 2. Add `restoreWorkspace()` method to ProjectManager

Added a new method that takes the data returned by the worker and applies it to the in-memory state:
- Sets `activeSessionId` and `activeProjectPath`
- For each project path, discovers sessions and stores the project in the `Map`

This separates the I/O (worker) from state management (main thread).

### 3. Update ThreadedProjectManager.loadWorkspace()

Changed from fire-and-forget to actually using the worker result:

```typescript
// Before: discarded result
await this.operationQueue.execute<>(
  'project:load-workspace',
  { workspacePath: this.projectManager.getWorkspacePath() }
)

// After: apply worker result to main-thread state
const result = await this.operationQueue.execute<>(
  'project:load-workspace',
  { workspacePath: this.projectManager.getWorkspacePath() }
)
await this.projectManager.restoreWorkspace(result)
```

### 4. Add error handling in index.ts

Wrapped `projectManager.loadWorkspace()` in try/catch to prevent UnhandledPromiseRejection.

## Files Changed

| File | Change |
|------|--------|
| `src/main/threading/worker-bootstrap.ts` | Added `handleProjectLoadWorkspace()` function + `case 'project:load-workspace'` in `dispatchOperation()` |
| `src/main/project-manager.ts` | Added `restoreWorkspace()` method |
| `src/main/threading/threaded-project-manager.ts` | Updated `loadWorkspace()` to apply worker results via `restoreWorkspace()` |
| `src/main/index.ts` | Added try/catch around `loadWorkspace()` call |
| `src/tests/threaded-project-manager.test.ts` | Added `restoreWorkspace` mock, updated comments |

## Lessons Learned

1. **When adding an operation type**, always add it in ALL three places: type definition, dispatch switch, AND the handler function. The type existed but the handler was never implemented.
2. **Worker operations that return data** must have the main-thread caller actually USE the returned data — fire-and-forget only works for operations without meaningful return values (like `saveWorkspace`).
3. **Always add try/catch** around awaited operations in the main process startup path to prevent UnhandledPromiseRejection from crashing the app.
