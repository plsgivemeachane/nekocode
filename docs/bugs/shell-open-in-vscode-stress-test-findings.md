# Shell Open-In-VSCode Stress Test Findings

**Date:** 2026-05-23
**Component:** Shell IPC handlers (`src/main/ipc-handlers.ts`) and TreeSidebar renderer
**Severity:** Critical → Low (multiple issues found)

---

## 🔴 BUG-1 (CRITICAL): encodeURIComponent Produces Broken VSCode URIs for Windows Paths

**File:** `src/main/ipc-handlers.ts` ~line 325

### Problem
The URI fallback path used `encodeURIComponent(targetPath)` which encodes `:` → `%3A` and `\` → `%5C`, producing broken URIs on Windows:

- **Actual:** `vscode://file/C%3A%5CUsers%5Cadmin%5Cproject`
- **Expected:** `vscode://file/C:/Users/admin/project/`

The `vscode://` URI scheme expects forward slashes and does NOT expect percent-encoded colons or backslashes. `encodeURIComponent` is designed for query-string encoding, not for path segments in URI schemes.

### Impact
Windows users without `code` in PATH get a completely non-functional "Open in VSCode" button — the URI handler cannot parse the broken path.

### Fix
1. Normalize backslashes to forward slashes: `targetPath.replace(/\\/g, '/')`
2. Use `encodeURI()` instead of `encodeURIComponent()` — `encodeURI` does NOT encode `:`, `/`, `#`, etc., which are valid URI characters
3. Add trailing `/` to the URI path: `vscode://file/C:/Users/admin/project/`

---

## 🟡 BUG-2 (MEDIUM): shell.openPath() Error Return Value Ignored

**File:** `src/main/ipc-handlers.ts` ~line 340

### Problem
`shell.openPath()` returns an empty string on success, or an error message string on failure. The original implementation always returned `true` regardless of the return value:

```typescript
// BEFORE (broken):
await shell.openPath(targetPath)
return true  // Always succeeds even when openPath fails
```

### Impact
Explorer open failures are reported as success to the renderer, making it impossible for the UI to show error feedback.

### Fix
Check the return value and return `false` if non-empty:

```typescript
const errorMsg = await shell.openPath(targetPath)
if (errorMsg) {
  logger.warn(`Failed to open in Explorer: ${targetPath} — ${errorMsg}`)
  return false
}
return true
```

---

## 🟢 BUG-3 (LOW): Floating Promise in TreeSidebar

**File:** `src/renderer/src/components/layout/TreeSidebar.tsx` ~line 228

### Problem
`openInVscode(projectPath)` was called without `await` or `.catch()`, meaning Promise rejections were silently swallowed:

```typescript
// BEFORE (broken):
onClick: () => {
  window.nekocode.shell.openInVscode(projectPath)  // Floating promise!
},
```

### Impact
Unhandled promise rejections silently swallowed. No error handling or user feedback on failure.

### Fix
Use `async/await` with try/catch:

```typescript
// AFTER (fixed):
onClick: () => handleShellOpen('vscode', project.path),
```

The `handleShellOpen` callback uses async/await with proper error handling, loading state, and toast feedback.

---

## Architectural Deviation 1: CLI-First Instead of URI-First

**Impact:** 10-second delay on Windows when `code` not in PATH

### Problem
The original implementation tried `code` CLI first, then `code-insiders`, then fell back to URI scheme. On Windows where `code` is not in PATH, each CLI attempt would timeout after 5 seconds, causing a 10+ second delay before the URI fallback.

### Fix
Reversed the strategy: URI-first (instant), then CLI fallback. The `vscode://` URI scheme is registered by VS Code on all platforms and opens instantly:

```typescript
// Strategy: URI-first. The vscode:// URI scheme is registered by VS Code
// on all platforms and opens instantly. CLI `code` command can have a
// 10+ second timeout on Windows when code is not in PATH.
try {
  await shell.openExternal(vscodeUri)
  return true
} catch {
  // Fallback to CLI
}
```

---

## Architectural Deviation 2: checkVscodeAvailable Returns False When CLI Not Found

**Impact:** Button grayed out even if VSCode installed via URI scheme

### Problem
`checkVscodeAvailable()` only checked for the `code` CLI and returned `{ available: false }` when not found. This caused the "Open in VS Code" button to be grayed out even when VS Code was installed and had its URI scheme registered.

### Fix
When CLI is not found, report `{ available: true, method: 'uri' }` since the URI scheme may still work. Updated the return type to include a `method` field:

```typescript
checkVscodeAvailable: () => Promise<{ available: boolean; command: string | null; method: 'cli' | 'uri' | null }>
```

---

## UX Gaps Fixed

| Gap | Fix |
|---|---|
| No user-visible feedback on openInVscode failure | Toast notification showing error message |
| No loading indicator during CLI timeout | `shellOpening` state with "Opening VS Code..." label |
| checkVscodeAvailable() never called by any component | `useEffect` check on mount, button disabled if unavailable |
| No debounce — rapid clicks spawn multiple shell commands | `useRef` debounce (1 second) on `handleShellOpen` |
| No editor selection — only VSCode stable | Infrastructure via `method` field for future extension |

---

## Pre-existing Test Failures Fixed

1. `src/tests/shared/ipc-channels.test.ts` — Expected 42 channels, got 45. Updated to 45 and added shell channel assertions.
2. `src/tests/preload/index.test.ts` — Namespace list didn't include "shell". Added shell namespace to expected namespaces and shell channel tests.
