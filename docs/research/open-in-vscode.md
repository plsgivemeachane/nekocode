# Open in VSCode Button — Research Report

> **Date:** 2026-05-19  
> **Status:** Research complete, ready for implementation  
> **Scope:** Add "Open in VSCode" button to NekoCode, enabling users to open their project folder in VSCode directly from the UI

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Analysis](#current-state-analysis)
3. [VSCode Integration Approaches](#vscode-integration-approaches)
4. [Recommended Architecture](#recommended-architecture)
5. [Implementation Plan](#implementation-plan)
6. [URI Encoding Edge Cases](#uri-encoding-edge-cases)
7. [Error Handling & UX Considerations](#error-handling--ux-considerations)
8. [Data Flow Diagram](#data-flow-diagram)
9. [Research Sources](#research-sources)
10. [Implementation Checklist](#implementation-checklist)
11. [Alternative Approaches](#alternative-approaches)

---

## Problem Statement

NekoCode is an AI-powered coding assistant that manages project folders and sessions. Users frequently need to open their project in VSCode for tasks that NekoCode doesn't handle (e.g., complex refactoring, multi-file editing, debugging with breakpoints). Currently there is no way to launch VSCode from within NekoCode — users must manually switch to VSCode and navigate to the same folder.

The TreeSidebar project context menu already has a **disabled placeholder** called "Open in Explorer" that was never fully implemented. This research explores how to properly implement both "Open in VSCode" and "Open in Explorer" functionality.

---

## Current State Analysis

### Existing Infrastructure

| Component | Location | Status |
|---|---|---|
| `shell` import | `src/main/index.ts` line 1 | ✅ Already imported: `import { app, BrowserWindow, Menu, shell } from 'electron'` |
| IPC pattern | `src/main/ipc-handlers.ts` | ✅ 20+ IPC channels using `ipcMain.handle` / `ipcRenderer.invoke` |
| Preload bridge | `src/preload/index.ts` | ✅ Full `contextBridge.exposeInMainWorld('nekocode', { ... })` pattern |
| IPC channel names | `src/shared/ipc-channels.ts` | ✅ Centralized `IPC_CHANNELS` constant |
| IPC type definitions | `src/shared/ipc-types.ts` | ✅ Full `NekoCodeIPC` interface with `session`, `dialog`, `project`, `workspace`, etc. |
| Context menu | `src/renderer/src/components/layout/TreeSidebar.tsx` ~line 170 | ✅ **Disabled placeholder** for "Open in Explorer" |

### The Disabled Placeholder

In `TreeSidebar.tsx`, the `openProjectMenu` callback contains:

```typescript
{
  label: 'Open in Explorer',
  icon: <svg ...>...</svg>,
  onClick: () => {
    // Use Electron shell to open folder
    window.nekocode.dialog.openFolder?.()
  },
  disabled: true,  // ← Currently disabled!
},
```

**Problems with this placeholder:**
1. It's `disabled: true` — never enabled
2. The `onClick` calls `dialog.openFolder()` which opens a **folder picker dialog**, NOT the file explorer — wrong API entirely
3. There's no "Open in VSCode" option at all

### NekoCodeIPC Interface (Current)

```typescript
export interface NekoCodeIPC {
  session: { ... }
  dialog: {
    openFolder: () => Promise<string | null>
  }
  project: { ... }
  workspace: { ... }
  git: { ... }
  update: { ... }
  zoom: { ... }
  notification: { ... }
  window: WindowApi
}
```

**Missing:** A `shell` namespace for OS-level operations like `openExternal()` and `openPath()`.

---

## VSCode Integration Approaches

### Method A: VSCode URI Scheme (`vscode://`) ⭐ RECOMMENDED (Primary)

**Official VSCode documentation** (scraped via Firecrawl from `code.visualstudio.com/docs/configure/command-line`):

```
Open a project folder:      vscode://file/{absolute-path}/
Open a specific file:       vscode://file/{absolute-path}/src/main.ts
Open file at line:col:      vscode://file/{absolute-path}/src/main.ts:42:5
VSCode Insiders variant:    vscode-insiders://file/{absolute-path}/
```

**How it works:**
- VSCode registers itself as a URI protocol handler during installation (all platforms)
- When the OS encounters a `vscode://` URL, it launches VSCode and passes the URI
- The URI is parsed by VSCode to determine what to open
- This is the same mechanism used by GitHub, GitLab, and other web tools

**Electron integration:**
```typescript
import { shell } from 'electron'
await shell.openExternal('vscode://file/E:/project/node/nekocode/')
```

**From Firecrawl-scraped Electron Shell API docs** (`electronjs.org/docs/latest/api/shell`):

> `shell.openExternal(url[, options])`
> - `url` string - Max 2081 characters on Windows
> - Returns `Promise<void>`
> - Open the given external protocol URL in the desktop's default manner
> - Options: `activate` (macOS), `workingDirectory` (Windows), `logUsage` (Windows)

| Pros | Cons |
|---|---|
| ✅ Zero dependency on `code` CLI in PATH | ❌ Cannot pre-detect if VSCode is installed |
| ✅ Cross-platform by default | ❌ Cannot pass CLI flags (`-r`, `-n`, etc.) |
| ✅ One-line implementation | ❌ Limited error feedback on failure |
| ✅ Opens in existing VSCode window if already open | |
| ✅ Official Microsoft-documented API | |
| ✅ Works even if `code` not in PATH | |

---

### Method B: VSCode CLI (`code` command)

```bash
code /path/to/project       # Open folder
code -r /path/to/project    # Reuse existing window
code -n /path/to/project    # New window
code --diff file1 file2     # Diff editor
```

**Electron integration:**
```typescript
import { spawn } from 'child_process'
spawn('code', [projectPath], { shell: true })
```

**Detection:**
```typescript
import { execFileSync } from 'child_process'
const command = process.platform === 'win32' ? 'where' : 'which'
const result = execFileSync(command, ['code'], { timeout: 3000 })
```

| Pros | Cons |
|---|---|
| ✅ Full CLI flag support | ❌ Requires `code` in PATH (often missing on Windows) |
| ✅ Can detect installation beforehand | ❌ Windows: `code.cmd` is batch — needs `shell: true` |
| ✅ More control over behavior | ❌ Platform-specific detection logic |
| | ❌ More complex error handling |

**Windows `code.cmd` gotcha:** On Windows, `code` is a `.cmd` batch file. You must use `shell: true` in `spawn()` or use `execFile('cmd', ['/c', 'code', projectPath])`. The URI scheme approach avoids this entirely.

---

### Method C: Direct Executable Path (Not Recommended)

| Platform | Default Path |
|---|---|
| Windows | `C:\Users\{user}\AppData\Local\Programs\Microsoft VS Code\Code.exe` |
| macOS | `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code` |
| Linux | `/usr/bin/code` or `/snap/bin/code` |

❌ Extremely brittle — paths vary by install method (user vs system, snap vs apt, Chocolatey, etc.). **Not recommended.**

---

### Comparison Matrix

| Criterion | URI Scheme | CLI | Direct Path |
|---|---|---|---|
| Cross-platform | ✅ Automatic | ⚠️ Platform logic needed | ❌ Per-platform paths |
| Requires PATH | ❌ No | ✅ Yes | ❌ No |
| Install detection | ❌ Not reliable | ✅ `where`/`which` | ⚠️ Fragile |
| CLI flags | ❌ No | ✅ Full support | ✅ Full support |
| Implementation complexity | 🟢 Low (1 line) | 🟡 Medium | 🔴 High |
| Error feedback | ⚠️ OS dialog only | ✅ Can catch errors | ✅ Can catch errors |
| Maintenance burden | 🟢 Minimal | 🟡 Platform-specific | 🔴 Brittle paths |

---

## Recommended Architecture

### Hybrid Approach: URI Scheme (Primary) + CLI Detection (UX Polish)

```
┌──────────────────────────────────────────────────────────┐
│  User clicks "Open in VSCode" button                     │
│                    │                                      │
│                    ▼                                      │
│  Renderer sends IPC: shell:openInVscode                   │
│                    │                                      │
│                    ▼                                      │
│  Main Process Handler:                                    │
│    1. Normalize path (backslashes → forward slashes)      │
│    2. Build URI: vscode://file/{normalizedPath}/          │
│    3. Call shell.openExternal(uri)                        │
│    4. If fails → throw error → renderer shows toast       │
│                                                           │
│  Optional UX Enhancement:                                 │
│    - On app load: checkVscodeAvailable()                  │
│    - If not available → gray out button + tooltip         │
└──────────────────────────────────────────────────────────┘
```

The primary mechanism is the URI scheme because it's the simplest, most reliable, and cross-platform. The CLI detection is a **UX enhancement** only — to conditionally gray out the button if VSCode isn't installed.

---

## Implementation Plan

### File 1: `src/shared/ipc-channels.ts`

Add 3 new channels to the `IPC_CHANNELS` object:

```typescript
// --- Shell handlers ---
SHELL_OPEN_IN_VSCODE: 'shell:openInVscode',
SHELL_OPEN_IN_EXPLORER: 'shell:openInExplorer',
SHELL_CHECK_VSCODE_AVAILABLE: 'shell:checkVscodeAvailable',
```

### File 2: `src/shared/ipc-types.ts`

Add payload/result types and extend `NekoCodeIPC`:

```typescript
/** Payload for opening a folder in VSCode */
export interface ShellOpenInVscodePayload {
  path: string
}

/** Payload for opening a folder in system file explorer */
export interface ShellOpenInExplorerPayload {
  path: string
}

/** Result of checking if VSCode is available */
export interface VscodeAvailabilityResult {
  available: boolean
  method: 'uri-scheme' | 'cli' | 'none'
  cliPath?: string
}
```

Add `shell` section to `NekoCodeIPC` interface:

```typescript
export interface NekoCodeIPC {
  // ... existing sections ...
  shell: {
    openInVscode: (path: string) => Promise<void>
    openInExplorer: (path: string) => Promise<void>
    checkVscodeAvailable: () => Promise<VscodeAvailabilityResult>
  }
}
```

### File 3: `src/main/ipc-handlers.ts`

Add 3 new IPC handlers in the `registerIpcHandlers` function:

```typescript
import { execFileSync } from 'child_process'

// --- Shell handlers ---
ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_IN_VSCODE, async (_event, payload: ShellOpenInVscodePayload) => {
  const { path } = payload
  logger.info(`SHELL_OPEN_IN_VSCODE path=${path}`)

  // Normalize path: backslashes → forward slashes for URI
  const normalizedPath = path.replace(/\\/g, '/')
  // Encode special characters (spaces, unicode, etc.)
  const encoded = encodeURI(normalizedPath)
  const uri = `vscode://file/${encoded}/`

  try {
    await shell.openExternal(uri)
    logger.info(`SHELL_OPEN_IN_VSCODE success uri=${uri}`)
  } catch (err) {
    logger.error(`SHELL_OPEN_IN_VSCODE failed`, err)
    throw err
  }
})

ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER, async (_event, payload: ShellOpenInExplorerPayload) => {
  const { path } = payload
  logger.info(`SHELL_OPEN_IN_EXPLORER path=${path}`)

  try {
    // shell.openPath opens the folder in the OS file manager (Explorer/Finder/Dolphin)
    // Returns empty string on success, error message string on failure
    const error = await shell.openPath(path)
    if (error) {
      logger.error(`SHELL_OPEN_IN_EXPLORER failed: ${error}`)
      throw new Error(error)
    }
    logger.info(`SHELL_OPEN_IN_EXPLORER success`)
  } catch (err) {
    logger.error(`SHELL_OPEN_IN_EXPLORER failed`, err)
    throw err
  }
})

ipcMain.handle(IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE, async () => {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(command, ['code'], { timeout: 3000, encoding: 'utf8' }).trim()
    logger.info(`SHELL_CHECK_VSCODE_AVAILABLE found CLI at: ${result}`)
    return { available: true, method: 'cli' as const, cliPath: result }
  } catch {
    // CLI not in PATH, but URI scheme may still work if VSCode is installed
    // We can't reliably detect URI scheme handlers without platform-specific registry queries,
    // so assume it might work (conservative: don't disable the button)
    logger.info(`SHELL_CHECK_VSCODE_AVAILABLE code CLI not in PATH, URI scheme may still work`)
    return { available: true, method: 'uri-scheme' as const }
  }
})
```

**Note:** `shell` is already imported at the top of `src/main/index.ts` but it needs to be accessible in `ipc-handlers.ts`. Since `registerIpcHandlers` receives the `BrowserWindow` reference, we can either:
1. Import `shell` directly in `ipc-handlers.ts` (simplest — `shell` is a module-level export from `electron`)
2. Pass `shell` as a parameter to `registerIpcHandlers`

Option 1 is simpler and follows the existing pattern (other electron APIs like `dialog` are imported directly).

### File 4: `src/preload/index.ts`

Add the `shellApi` and expose it:

```typescript
const shellApi: NekoCodeIPC['shell'] = {
  openInVscode: (path: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_IN_VSCODE, { path }),

  openInExplorer: (path: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER, { path }),

  checkVscodeAvailable: (): Promise<VscodeAvailabilityResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE),
}

// Add to contextBridge.exposeInMainWorld:
contextBridge.exposeInMainWorld('nekocode', {
  session: sessionApi,
  dialog: dialogApi,
  project: projectApi,
  workspace: workspaceApi,
  git: gitApi,
  update: updateApi,
  zoom: zoomApi,
  notification: notificationApi,
  window: windowApi,
  shell: shellApi,  // ← NEW
})
```

### File 5: `src/renderer/src/global.d.ts`

Add `shell` type to the Window interface declaration so TypeScript knows about `window.nekocode.shell`.

### File 6: `src/renderer/src/components/layout/TreeSidebar.tsx`

**Fix the disabled "Open in Explorer" placeholder and add "Open in VSCode":**

Replace the existing disabled menu item (~line 170):

```typescript
// BEFORE (broken):
{
  label: 'Open in Explorer',
  icon: <svg ...>...</svg>,
  onClick: () => {
    window.nekocode.dialog.openFolder?.()  // Wrong — opens folder picker!
  },
  disabled: true,
},

// AFTER (working):
{
  label: 'Open in VSCode',
  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M9.5 2L3 5l6.5 3L16 5l-6.5-3z" stroke="currentColor" strokeWidth="1.2" />
    <path d="M3 5v8l6.5 3V8L3 5z" stroke="currentColor" strokeWidth="1.2" />
    <path d="M9.5 8v8l6.5-3V5l-6.5 3z" stroke="currentColor" strokeWidth="1.2" />
  </svg>,
  onClick: () => window.nekocode.shell.openInVscode(project.path),
},
{
  label: 'Open in Explorer',
  icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M1.5 3.5v9h13v-7l-2-2h-6l-1.5-2h-2.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>,
  onClick: () => window.nekocode.shell.openInExplorer(project.path),
},
```

Key changes:
1. Added "Open in VSCode" as a new menu item
2. Fixed "Open in Explorer" to call `shell.openInExplorer(project.path)` instead of `dialog.openFolder()`
3. Removed `disabled: true` from "Open in Explorer"

### File 7: `src/renderer/src/components/layout/NavBar.tsx` (Optional Enhancement)

Add a VSCode icon button in the toolbar, visible when a project is active:

```tsx
{state.activeProjectPath && (
  <button
    onClick={() => window.nekocode.shell.openInVscode(state.activeProjectPath!)}
    title="Open project in VSCode"
    className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-700 rounded-md transition-colors"
  >
    <VSCodeIcon />
  </button>
)}
```

---

## URI Encoding Edge Cases

**Critical for Windows paths with spaces or special characters:**

```typescript
function buildVscodeUri(folderPath: string): string {
  // Step 1: Normalize backslashes to forward slashes
  const normalized = folderPath.replace(/\\/g, '/')
  // Step 2: Encode special characters (spaces → %20, unicode, etc.)
  const encoded = encodeURI(normalized)
  // Step 3: Build the URI
  return `vscode://file/${encoded}/`
}

// Test cases:
buildVscodeUri('C:\\Users\\admin\\My Project')
// → 'vscode://file/C:/Users/admin/My%20Project/'

buildVscodeUri('E:/project/node/nekocode')
// → 'vscode://file/E:/project/node/nekocode/'

buildVscodeUri('C:\\Users\\马\\项目')
// → 'vscode://file/C:/Users/%E9%A9%AC/%E9%A1%B9%E7%9B%AE/'
```

**Important:** Use `encodeURI()` (NOT `encodeURIComponent()`) — we want to preserve `/` and `:` in the path.

**Windows URL length limit:** 2081 characters max (from Electron docs). Not a concern for typical project paths.

---

## Error Handling & UX Considerations

### VSCode Not Installed

If `shell.openExternal('vscode://...')` is called and VSCode isn't installed:

| Platform | Behavior |
|---|---|
| Windows | OS shows "You'll need a new app to open this vscode link" dialog |
| macOS | Shows "No application can open this URL" alert |
| Linux | May silently fail or show error depending on DE |

**Enhancement:** Use `checkVscodeAvailable()` to detect and conditionally disable the button:

```typescript
const [vscodeAvailable, setVscodeAvailable] = useState<boolean | null>(null)

useEffect(() => {
  window.nekocode.shell.checkVscodeAvailable().then(result => {
    setVscodeAvailable(result.available)
  }).catch(() => setVscodeAvailable(false))
}, [])
```

### VSCode Insiders Support

Some users use VSCode Insiders instead of stable. The `vscode-insiders://` URI scheme works identically:

```typescript
const uri = useInsiders
  ? `vscode-insiders://file/${encodedPath}/`
  : `vscode://file/${encodedPath}/`
```

This could be a future settings option.

### Opening Specific Files & Lines

Future enhancement: if the user clicks a file reference in the AI chat, open that file in VSCode at the exact line:

```typescript
// From a chat message mentioning "src/main.ts:42"
window.nekocode.shell.openInVscode('E:/project/node/nekocode/src/main.ts:42')
// → vscode://file/E:/project/node/nekocode/src/main.ts:42
```

### Other Editors (Cursor, Windsurf, etc.)

The same URI scheme approach works for other VSCode-based editors:

| Editor | URI Scheme |
|---|---|
| VSCode | `vscode://file/{path}/` |
| VSCode Insiders | `vscode-insiders://file/{path}/` |
| Cursor | `cursor://file/{path}/` |
| Windsurf | `windsurf://file/{path}/` |

A future settings option could let users choose their preferred editor.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER (React)                                                │
│                                                                  │
│  TreeSidebar.tsx / NavBar.tsx                                    │
│  ┌─────────────────────────┐                                     │
│  │ "Open in VSCode" button │                                     │
│  │ onClick → window.nekocode.shell.openInVscode(projectPath)     │
│  └────────────┬────────────┘                                     │
│               │                                                  │
│               ▼                                                  │
│  Preload (contextBridge)                                         │
│  ┌──────────────────────────────────┐                            │
│  │ shellApi.openInVscode(path)       │                           │
│  │ → ipcRenderer.invoke(             │                           │
│  │     'shell:openInVscode',         │                           │
│  │     { path }                      │                           │
│  │   )                               │                           │
│  └────────────┬─────────────────────┘                            │
│               │                                                  │
└───────────────┼──────────────────────────────────────────────────┘
                │ IPC (async invoke/handle)
┌───────────────┼──────────────────────────────────────────────────┐
│  MAIN (Electron)                                                │
│               ▼                                                  │
│  ipc-handlers.ts                                                 │
│  ┌──────────────────────────────────────────────────┐            │
│  │ ipcMain.handle('shell:openInVscode', (e, payload) │           │
│  │   const normalized = payload.path.replace(/\\/g,'/')│          │
│  │   const uri = `vscode://file/${normalized}/`       │           │
│  │   shell.openExternal(uri)                         │           │
│  │ )                                                 │           │
│  └────────────┬─────────────────────────────────────┘            │
│               ▼                                                  │
│  Electron shell.openExternal()                                   │
│  ┌──────────────────────────────────────────────────┐            │
│  │ OS resolves vscode:// URI protocol                 │           │
│  │ → Launches VSCode with the specified folder       │           │
│  └──────────────────────────────────────────────────┘            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Research Sources

All sources were accessed via Firecrawl web search and scraping.

| Source | URL | Key Finding |
|---|---|---|
| VSCode Official CLI Docs | `code.visualstudio.com/docs/configure/command-line` | `vscode://file/{path}/` URI scheme for opening folders; `code` CLI with `-r`/`-n` flags |
| Electron Shell API | `electronjs.org/docs/latest/api/shell` | `shell.openExternal(url)` for URI schemes; `shell.openPath(path)` for file explorer; Windows max URL 2081 chars |
| Firecrawl Search: "VSCode URI scheme open folder" | Multiple results | URI scheme is the industry-standard approach used by GitHub, GitLab, Cursor, etc. |
| Firecrawl Search: "Electron shell.openExternal vscode URI" | Multiple results | Confirmed `shell.openExternal()` is the standard Electron method for opening custom URI schemes |
| Firecrawl Search: "Electron open external VSCode from app" | Multiple results | Pattern is widely used in Electron apps that integrate with VSCode |
| Windows URI Protocol Handling | Microsoft docs | VSCode registers `vscode://` protocol on install; Windows resolves via `start` command |

### Firecrawl Raw Data Locations

The raw Firecrawl search/scrape results are stored in:
- `.firecrawl/search-vscode-uri.json` — VSCode URI scheme search results
- `.firecrawl/search-electron-vscode.json` — Electron+VSCode integration search results
- `.firecrawl/search-electron-shell.json` — Electron shell API search results
- `.firecrawl/vscode-cli-docs.md` — Scraped VSCode CLI documentation
- `.firecrawl/electron-shell-docs.md` — Scraped Electron shell API documentation

---

## Implementation Checklist

- [ ] `src/shared/ipc-channels.ts` — Add `SHELL_OPEN_IN_VSCODE`, `SHELL_OPEN_IN_EXPLORER`, `SHELL_CHECK_VSCODE_AVAILABLE` channels
- [ ] `src/shared/ipc-types.ts` — Add `ShellOpenInVscodePayload`, `ShellOpenInExplorerPayload`, `VscodeAvailabilityResult` types and `shell` section to `NekoCodeIPC`
- [ ] `src/main/ipc-handlers.ts` — Register 3 IPC handlers using `shell.openExternal()`, `shell.openPath()`, and `execFileSync('where'/'which', ['code'])`
- [ ] `src/preload/index.ts` — Expose `shellApi` on `contextBridge`
- [ ] `src/renderer/src/global.d.ts` — Add `shell` type to Window interface declaration
- [ ] `src/renderer/src/components/layout/TreeSidebar.tsx` — Fix disabled "Open in Explorer" + add "Open in VSCode" to project context menu
- [ ] `src/renderer/src/components/layout/NavBar.tsx` — (Optional) Add VSCode icon button in toolbar
- [ ] `src/tests/` — Add tests for IPC handlers and shell API
- [ ] `docs/bugs/` — Document the feature addition
- [ ] Run `bun run test` + `bun run lint` + `bun run type-check` + `bun run package:local`

---

## Alternative Approaches

### Alternative 1: Use `child_process.spawn('code')` as Primary

Rejected because:
- Requires `code` in PATH (unreliable on Windows)
- Platform-specific detection logic
- More error cases to handle
- The URI scheme is simpler and more reliable

### Alternative 2: Bundle a VSCode Extension

Could create a NekoCode VSCode extension that communicates with the Electron app via WebSocket or HTTP. This would enable:
- Two-way sync of open files
- NekoCode sending commands to VSCode (open file, goto line, etc.)
- VSCode sending diagnostics back to NekoCode

Rejected for initial implementation because:
- Massive scope increase
- Requires users to install a VSCode extension
- The URI scheme provides the core "open folder" functionality with zero setup

**Future consideration:** A NekoCode VSCode extension would be a powerful enhancement for deep integration (bi-directional communication, real-time diagnostics sharing, etc.).

### Alternative 3: Embed Monaco Editor with VSCode Keybindings

Could enhance the existing Monaco editor in NekoCode to support VSCode keybindings and more editor features. This doesn't provide "Open in VSCode" but reduces the need for it.

Rejected because:
- Different use case — users want to open their **full VSCode setup** (extensions, settings, debug configs)
- Doesn't replace the need to jump to VSCode for debugging, Git operations, etc.

### Alternative 4: Registry-Based VSCode Detection (Windows Only)

On Windows, could check the registry for the VSCode URI handler:

```typescript
import { execFileSync } from 'child_process'
// Check if vscode:// protocol is registered
const result = execFileSync('reg', ['query', 'HKEY_CLASSES_ROOT\\vscode', '/ve'], { encoding: 'utf8' })
```

Rejected because:
- Windows-only
- Fragile registry path
- The `where code` check is simpler and sufficient for UX purposes
- URI scheme may work even if registry check fails (e.g., per-user registrations)
