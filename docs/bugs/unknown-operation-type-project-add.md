# Bug: Unknown operation type: project:add

**Date:** 2026-06-07
**Severity:** High — causes project addition to fail and throws UnhandledPromiseRejection
**Status:** Fixed

## Symptoms

When trying to add a project in NekoCode, the following error appeared in the logs and console:

```
[threaded-project-manager] debug: addProject: E:\project\Python\crazythinker - offloading to operation queue
[thread-queue] debug: Enqueued operation 8fc40fdc-116c-429e-9065-72a2dd4818f7 (type=project:add, priority=normal)
[thread-queue] debug: Dispatched operation 8fc40fdc-116c-429e-9065-72a2dd4818f7 to worker
[worker] debug: Received operation: project:add
[worker] error: Operation project:add failed:
[thread-queue] warn: Operation 8fc40fdc-116c-429e-9065-72a2dd4818f7 failed: Unknown operation type: project:add
[ipc-handlers] error: PROJECT_ADD failed path=E:\project\Python\crazythinker Unknown operation type: project:add
Error: Unknown operation type: project:add
    at ThreadOperationQueue.handleWorkerMessage (E:\project\node\nekocode\out\main\index.js:140836:30)
```

Adding a project failed completely.

## Root Cause

`ThreadedProjectManager.addProject()` delegates the project addition (specifically the slow filesystem scanning / session discovery) to the worker thread via `operationQueue.execute('project:add', { path })`. 

However, the worker's `dispatchOperation()` switch statement in `worker-bootstrap.ts` was **missing** the case for `project:add`.

Additionally, like in the workspace loading flow, the worker executes in a separate thread and does not have access to the main thread's `ProjectManager` in-memory state. Directly returning the project info from the worker is not enough to update the in-memory map on the main thread, meaning subsequent list operations and saving the workspace would not include the newly added project.

## Fix

### 1. Add `handleProjectAdd` to `worker-bootstrap.ts`

Added the worker-side handler that:
- Calls the existing `handleProjectDiscoverSessions` function to list sessions on the project path.
- Returns a `ProjectInfo` structure with the discovered sessions.
- Added `case 'project:add':` in `dispatchOperation()`.

### 2. Implement `addProjectWithSessions` in `ProjectManager`

Added a method on the core main-thread `ProjectManager` to register a project path with pre-discovered sessions:
- Normalizes path key and checks if already tracked.
- Increments the next ID, registers the project in-memory, and saves the workspace to disk.
- This delegates the heavy file scanning to the worker thread while keeping the state mutation on the main thread.

### 3. Update `ThreadedProjectManager.addProject`

Changed `addProject(path)` to execute the worker task, retrieve the discovered sessions, and synchronize that data back to the main thread `ProjectManager`:

```typescript
  async addProject(path: string): Promise<ProjectInfo> {
    logger.debug(`addProject: ${path} - offloading to operation queue`)
    const projectInfo = await this.operationQueue.execute<ProjectAddInput, ProjectAddOutput>(
      'project:add',
      { path }
    )
    // Synchronize the added project with the main-thread ProjectManager's state
    return this.projectManager.addProjectWithSessions(path, projectInfo.sessions)
  }
```

## Files Changed

| File | Change |
|------|--------|
| `src/main/project-manager.ts` | Implemented `addProjectWithSessions(path, sessions)` method |
| `src/main/threading/threaded-project-manager.ts` | Updated `addProject` to execute worker operation and register via core manager |
| `src/main/threading/worker-bootstrap.ts` | Implemented `handleProjectAdd` function and registered `'project:add'` case |
| `src/tests/threaded-project-manager.test.ts` | Mocked `addProjectWithSessions` to avoid runtime failures |
