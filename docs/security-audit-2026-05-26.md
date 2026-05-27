# 🔒 NekoCode Security Audit Report

**Project:** NekoCode v0.2.61  
**Stack:** Electron 42 + React + TypeScript + Pi SDK  
**Date:** 2026-05-26  
**Auditor:** Automated security review via pi  

---

## Executive Summary

NekoCode demonstrates **strong baseline security** for an Electron application. The preload correctly uses `contextBridge`, there is no `nodeIntegration`, no `eval()` or `dangerouslySetInnerHTML` misuse for user content, and git operations use `simple-git` (not raw shell commands) with input validation. However, several findings require attention, ranging from a critical dependency issue to medium-risk configuration gaps.

**Overall Risk Rating: 🟡 MEDIUM** — No active exploitation paths in the app itself, but dependency vulnerabilities and configuration issues need remediation.

---

## 1. INJECTION

### 1.1 🟠 Command Injection via `shell.openExternal()` — Unvalidated URL Scheme
**File:** `src/main/index.ts:85`  
**Detail:** The `setWindowOpenHandler` passes `url` directly to `shell.openExternal(url)` without validating the protocol. An attacker-controlled URL (e.g., from AI-generated markdown) with schemes like `file://`, `javascript:`, or custom protocol handlers could open local files or trigger application launches.

```typescript
// CURRENT (vulnerable)
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)  // No URL validation!
    return { action: 'deny' }
})
```

**Remediation:**
```typescript
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
        const parsed = new URL(url)
        if (['http:', 'https:'].includes(parsed.protocol)) {
            shell.openExternal(url)
        } else {
            logger.warn(`Blocked openExternal for non-HTTP URL: ${url}`)
        }
    } catch {
        logger.warn(`Invalid URL in setWindowOpenHandler: ${url}`)
    }
    return { action: 'deny' }
})
```

---

### 1.2 🔵 Path Traversal — `SHELL_OPEN_IN_VSCODE` / `SHELL_OPEN_IN_EXPLORER`
**File:** `src/main/ipc-handlers.ts:395–445`  
**Detail:** The `SHELL_OPEN_IN_VSCODE` and `SHELL_OPEN_IN_EXPLORER` handlers accept arbitrary `path` strings from the renderer. While Electron's `shell.openPath()` is designed for this, a compromised renderer could open arbitrary system paths. The `vscode://` URI is constructed with `encodeURI()` rather than `encodeURIComponent()` for path segments.

**Risk is LOW** because: (a) a compromised renderer already has significant access via IPC, (b) `shell.openPath` is not equivalent to executing a file, (c) the git operations already have proper `validateCwd()` checks.

**Remediation:** Add path validation to shell handlers, confirming the path is within a known project directory:
```typescript
// Validate path is within an open project
const projectPaths = await projectManager.listProjects()
const isSubpath = projectPaths.some(p => targetPath.startsWith(p.path))
if (!isSubpath) {
    logger.warn(`Rejected shell open for path outside projects: ${targetPath}`)
    return false
}
```

---

### 1.3 🟢 SQL Injection — NOT APPLICABLE
No SQL databases are used. Session data is stored as flat files via the Pi SDK.

---

### 1.4 🟢 XSS — Well Mitigated
**Findings:**
- `react-markdown` is used (safe by default — no `dangerouslySetInnerHTML` for user content)
- `dangerouslySetInnerHTML` is used ONLY for Shiki syntax highlighting output (line 186 of MarkdownContent.tsx), which generates HTML from a trusted library, not from user input directly
- No `eval()`, `new Function()`, or `document.write()` found in renderer code
- Links render with `rel="noopener noreferrer"` and `target="_blank"`

**Note:** The Shiki `dangerouslySetInnerHTML` usage is **safe** because Shiki generates HTML from code tokens it controls, not from raw user input. The input passes through `react-markdown`'s code block parser first.

---

## 2. AUTHENTICATION

### 2.1 🟡 No Renderer-to-Main IPC Authentication
**File:** `src/main/ipc-handlers.ts` (all handlers)  
**Detail:** Every IPC handler trusts that the renderer is legitimate. There is no session token, origin check, or message signing. If a malicious page were loaded in the renderer (e.g., via navigation hijack), it could invoke any IPC handler.

**Risk is MEDIUM** because: The renderer loads only trusted content (local HTML or dev server), `contextIsolation` is implicitly enabled (Electron default since v12), and `nodeIntegration` is not enabled. However, if an XSS were found, the lack of IPC auth means full main-process access.

**Remediation:** Add an IPC authentication token generated at window creation:
```typescript
// In main process:
const ipcToken = crypto.randomUUID()
mainWindow.webContents.executeJavaScript(`window.__IPC_TOKEN = '${ipcToken}'`)

// In each handler:
ipcMain.handle(channel, async (event, payload) => {
    if (payload._ipcToken !== ipcToken) throw new Error('Unauthorized IPC call')
    // ... handler logic
})
```

---

### 2.2 🟢 No Hardcoded Credentials or API Keys Found
A full-text search for `api_key`, `secret`, `password`, `token`, `credential`, `private_key` found zero matches for hardcoded values. All authentication to AI providers flows through the Pi SDK's `AuthStorage` mechanism.

---

## 3. AUTHORIZATION

### 3.1 🔵 IDOR — Session ID Guessability
**File:** `src/main/session-manager.ts`  
**Detail:** Session IDs appear to be SDK-generated identifiers. If they are sequential or predictable, a renderer-side attacker could access other sessions. This is low risk because the renderer has no cross-origin attack surface and sessions are local-only.

**Remediation:** Verify that the Pi SDK generates cryptographically random session IDs. If using UUIDs, confirm they are v4 (random) not v1 (MAC-based).

---

### 3.2 🔵 No Fine-Grained Authorization on IPC
**Detail:** All IPC handlers are available to any renderer. There is no role-based or capability-based access control. A compromised renderer process can invoke any handler.

**Remediation:** Implement a capability system where the preload only exposes IPC methods that the current UI state needs.

---

## 4. DATA EXPOSURE

### 4.1 🟡 User Prompt Text Logged at INFO Level
**File:** `src/main/ipc-handlers.ts:63`, `src/main/session-manager.ts:275`  
**Detail:** User prompts are logged with up to 80–120 characters of text:
```typescript
logger.info(`SESSION_PROMPT sessionId=${payload.sessionId} text=${payload.text.slice(0, 80)}`)
logger.info(`Prompt ${sessionId} text=${text.slice(0, 120)}...`)
```
This means sensitive user data (code, passwords pasted in chat, API keys discussed) is written to log files on disk. Log files persist and may be accessible to other users or processes.

**Remediation:** Never log user prompt content. Log only metadata:
```typescript
logger.info(`SESSION_PROMPT sessionId=${payload.sessionId} length=${payload.text.length}`)
```

---

### 4.2 🔵 Extension Load Paths Logged
**File:** `src/main/extension-loader.ts` (multiple lines)  
**Detail:** Full filesystem paths of loaded extensions are logged. This reveals the user's directory structure.

**Remediation:** Basename-only logging for extension paths, or redact user home directory.

---

### 4.3 🟢 No Sensitive Data in IPC Responses
Chat message payloads contain model output and user input, but this is expected and necessary for app functionality. No API keys, tokens, or credentials are sent to the renderer.

---

## 5. CONFIGURATION

### 5.1 🟠 `sandbox: false` in BrowserWindow
**File:** `src/main/index.ts:65`  
**Detail:** The renderer process has `sandbox: false` in `webPreferences`. This means the preload script runs with full Node.js access. If the preload were compromised (e.g., prototype pollution), it could access `require`, `process`, `fs`, etc.

**Risk is HIGH** because: Without sandboxing, the renderer process (even with `contextIsolation`) has a larger attack surface. The preload script has Node.js access and bridges it to the renderer via `contextBridge`.

**Remediation:** Migrate to `sandbox: true`. This requires:
1. Removing any Node.js usage from the preload (it currently only uses `ipcRenderer`, which works in sandboxed mode)
2. Ensuring `contextBridge.exposeInMainWorld` is the only communication mechanism
3. Testing that all IPC channels work correctly with sandboxed preload

**Note:** The current preload ONLY uses `ipcRenderer` methods (`.invoke`, `.on`, `.send`), which are all available in sandboxed mode. This migration should be straightforward.

---

### 5.2 🟡 DevTools Accessible via F12 Key
**File:** `src/main/index.ts:102–106`  
**Detail:** Pressing F12 toggles DevTools in production builds. This allows any user (or anyone with physical access) to inspect and modify the running application state, invoke IPC methods, and potentially bypass UI restrictions.

**Remediation:** Disable DevTools in production:
```typescript
if (app.isPackaged) {
    // Disable DevTools in production
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
            event.preventDefault()
            return
        }
    })
}
```

---

### 5.3 🔵 Dev Server URL from Environment Variable
**File:** `src/main/index.ts:128`  
**Detail:** `process.env.ELECTRON_RENDERER_URL` is used to load the renderer URL. In development, this points to the Vite dev server. If an attacker could set this environment variable, they could load arbitrary content.

**Risk is LOW** because: Environment variable injection requires local access, and this only affects development mode.

---

### 5.4 🟢 No CORS Misconfiguration
NekoCode is a desktop Electron app. It does not serve HTTP endpoints. No CORS headers are set. No custom protocol handlers are registered. No risk here.

---

### 5.5 🟢 No Default Credentials
No default usernames, passwords, or tokens found in the codebase.

---

## 6. DEPENDENCIES

### 6.1 🔴 Electron 42 — Multiple Known CVEs (Unpatched)
**Severity:** CRITICAL  
**Detail:** `bun audit` reports **21 vulnerabilities** in the Electron dependency chain, including:
- **5 HIGH:** Use-after-free in offscreen window paint, PowerMonitor, WebContents permission callbacks, renderer command-line switch injection
- **13 MODERATE:** ASAR integrity bypass, heap buffer overflow in NativeImage, Service Worker IPC spoofing, nodeIntegrationInWorker scoping, registry key path injection, download dialog use-after-free, HTTP header injection, named window.open target scoping
- **3 LOW:** Unquoted executable path in setLoginItemSettings, USB device selection, clipboard crash

**Root Cause:** Electron is listed as `^42.1.0` but the installed version has unfixed CVEs.

**Remediation:**
```bash
bun update electron --latest
```
Verify the updated version addresses the listed CVEs. If Electron 42.x is too old for patches, consider upgrading to the latest stable Electron major version.

---

### 6.2 🟠 cross-spawn < 6.0.6 — ReDoS Vulnerability (GHSA-3xgq-45jj-v275)
**Severity:** HIGH  
**Detail:** `cross-spawn` is a transitive dependency pulled in by multiple packages (eslint, patch-package, react-devtools, electron-builder). Version < 6.0.6 is vulnerable to Regular Expression Denial of Service.

**Remediation:** Add a resolution in `package.json`:
```json
{
  "resolutions": {
    "cross-spawn": "^7.0.6"
  }
}
```

---

### 6.3 🟡 got < 11.8.5 — UNIX Socket Redirect (GHSA-pfrx-2q88-qq97)
**Severity:** MEDIUM  
**Detail:** The `got` HTTP client (used by `@electron/get` and `electron-builder`) allows redirects to UNIX sockets, potentially enabling SSRF-like attacks during update checks.

**Remediation:** This is a transitive dependency. Update `electron` and `electron-builder` to latest versions that use a patched `got`.

---

## Summary Table

| # | Category | Finding | Severity | File |
|---|----------|---------|----------|------|
| 1.1 | Injection | `shell.openExternal()` — unvalidated URL scheme | 🟠 High | index.ts:85 |
| 1.2 | Injection | Shell handlers — no path scope validation | 🔵 Low | ipc-handlers.ts:395–445 |
| 2.1 | Auth | No IPC authentication token | 🟡 Medium | ipc-handlers.ts |
| 3.1 | AuthZ | Session ID guessability | 🔵 Low | session-manager.ts |
| 3.2 | AuthZ | No capability-based IPC access | 🔵 Low | ipc-handlers.ts |
| 4.1 | Data Exposure | User prompt text logged at INFO | 🟡 Medium | ipc-handlers.ts:63, session-manager.ts:275 |
| 4.2 | Data Exposure | Extension paths logged | 🔵 Low | extension-loader.ts |
| 5.1 | Config | `sandbox: false` in BrowserWindow | 🟠 High | index.ts:65 |
| 5.2 | Config | DevTools accessible in production (F12) | 🟡 Medium | index.ts:102–106 |
| 5.3 | Config | Dev URL from env var | 🔵 Low | index.ts:128 |
| 6.1 | Dependencies | Electron — 21 CVEs (5 high) | 🔴 Critical | package.json |
| 6.2 | Dependencies | cross-spawn ReDoS | 🟠 High | transitive |
| 6.3 | Dependencies | got UNIX socket redirect | 🟡 Medium | transitive |

---

## Priority Remediation Order

1. **🔴 Update Electron** — Patch the 21 known CVEs immediately
2. **🟠 Enable `sandbox: true`** — Preload already uses only `ipcRenderer`, making this a low-effort, high-impact fix
3. **🟠 Validate URLs in `setWindowOpenHandler`** — Only allow `http:` and `https:` schemes
4. **🟠 Pin `cross-spawn` resolution** — Force updated version via package.json resolutions
5. **🟡 Stop logging user prompt text** — Replace with length-only logging
6. **🟡 Add IPC authentication token** — Generate at window creation, verify in handlers
7. **🟡 Disable DevTools in production** — Guard with `app.isPackaged`
8. **🔵 Add path scoping to shell handlers** — Validate paths are within project directories
9. **🔵 Verify session ID randomness** — Confirm Pi SDK uses crypto-random IDs
