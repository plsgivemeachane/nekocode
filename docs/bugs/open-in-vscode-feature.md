## Feature: Open in VS Code & Open in Explorer

**Date:** 2026-05-22
**Status:** Implemented
**Research Doc:** `docs/research/open-in-vscode.md`

### Problem

The "Open in Explorer" context menu item in the TreeSidebar was non-functional — it called `window.nekocode.dialog.openFolder?.()` with `disabled: true`, which was a stub that never worked. There was also no way to open a project in VS Code from the NekoCode UI.

### Solution

Added a new `shell` IPC namespace with three methods:

1. **`shell.openInVscode(path)`** — Opens a file/folder in VS Code. Tries `code` CLI first, then `code-insiders`, then falls back to `vscode://` URI handler.
2. **`shell.openInExplorer(path)`** — Opens a folder in the system file explorer using Electron's `shell.openPath()`.
3. **`shell.checkVscodeAvailable()`** — Checks if VS Code CLI (`code` or `code-insiders`) is available on the system.

### Files Changed

| File | Change |
|------|--------|
| `src/shared/ipc-channels.ts` | Added `SHELL_OPEN_IN_VSCODE`, `SHELL_OPEN_IN_EXPLORER`, `SHELL_CHECK_VSCODE_AVAILABLE` channels |
| `src/shared/ipc-types.ts` | Added `ShellApi` interface and `shell: ShellApi` to `NekoCodeIPC` |
| `src/main/ipc-handlers.ts` | Added IPC handlers using `child_process.execFile` and `shell.openPath`/`shell.openExternal` |
| `src/preload/index.ts` | Exposed `shell` API via `contextBridge`, imported `ShellApi` type |
| `src/renderer/src/components/layout/TreeSidebar.tsx` | Fixed "Open in Explorer" to use `shell.openInExplorer()`, added "Open in VS Code" to project and session context menus |
| `src/renderer/src/components/layout/NavBar.tsx` | Added VS Code icon button next to "Add Project" button |
| `src/tests/__utils__/test-utils.tsx` | Added `shell` mock to `createMockIPC()` |

### Implementation Details

- **VS Code detection:** Uses `execFileAsync` to try `code --version` then `code-insiders --version` with a 5-second timeout.
- **Opening in VS Code:** Tries `code <path>` then `code-insiders <path>`, falls back to `vscode://file/<path>` URI scheme.
- **Opening in Explorer:** Uses Electron's built-in `shell.openPath()` which works cross-platform (Explorer on Windows, Finder on macOS, default file manager on Linux).
- **NavBar button:** Opens the currently active project in VS Code. Disabled when no project is active.
- **Session context menu:** Added "Open Project in VS Code" option.

### Testing

- All existing tests pass (type-check, lint, unit tests, package:local build)
- Added `shell` mock to test utilities to maintain type safety
