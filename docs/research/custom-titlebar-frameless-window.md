# Custom Title Bar & Frameless Window Implementation

> **Date:** 2026-05-17  
> **Status:** Research complete, ready for implementation  
> **Scope:** Remove native Windows title bar, create custom window controls, relocate config button to sidebar bottom

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Analysis](#current-state-analysis)
3. [Implementation Plan](#implementation-plan)
4. [File Change Summary](#file-change-summary)
5. [Important Considerations](#important-considerations)
6. [Alternative Approaches](#alternative-approaches)

---

## Problem Statement

The default Windows title bar shows the green "NekoCode" name with the standard minimize/maximize/close buttons. The user wants to:

1. **Remove the native Windows title bar** (the green top bar with "NekoCode" and 3 default buttons)
2. **Create custom window control buttons** (minimize, maximize/restore, close) integrated into the app UI
3. **Move the config/settings button** from the top NavBar down to the **bottom-left of the sidebar**

---

## Current State Analysis

### 1. Electron Window Configuration

**File:** `src/main/index.ts` (line 56)

The `createWindow()` function creates a standard framed BrowserWindow:

```typescript
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  icon: join(__dirname, '../../resources/icon.ico'),
  autoHideMenuBar: true,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false
  }
})
```

- **No `frame: false`** — Uses the default native Windows frame
- **No `titleBarStyle`** — Uses the default title bar style
- **No `-webkit-app-region: drag` CSS** exists anywhere in the codebase
- The native title bar displays the app icon + "NekoCode" text + min/max/close buttons

### 2. NavBar Component

**File:** `src/renderer/src/components/layout/NavBar.tsx`

A 48px-tall (`h-12`) header bar at the top of the ChatView. Contains:

- **Zoom controls** (decrement, percentage display, increment)
- **Divider**
- **Settings gear button** — navigates to SettingsView via `setActiveView('settings')`

No app title, no draggable region, no window control buttons.

### 3. App Layout

**File:** `src/renderer/src/App.tsx`

```tsx
<div className="flex h-screen overflow-hidden bg-surface-950">
  <TreeSidebar />
  {state.activeView === 'settings' ? <SettingsView /> : <ChatView ... />}
</div>
```

- Simple horizontal flex: TreeSidebar | (ChatView or SettingsView)
- Full screen height (`h-screen`)
- No title bar component at the top level

### 4. TreeSidebar

**File:** `src/renderer/src/components/layout/TreeSidebar.tsx` (344 lines)

- Contains project list and session list
- Has action buttons (new project, new session) at the top
- **No settings/config button** — that button currently lives in NavBar
- Layout is a flex column but does NOT have a `mt-auto` bottom section

### 5. IPC Channels

**File:** `src/shared/ipc-channels.ts`

No window control channels exist. The current channels are:
- Session management (create, prompt, abort, dispose, delete, reconnect, load-history)
- Dialog (openFolder)
- Project (add, remove, list, sessions)
- Workspace (setActive, getActive)
- Model (get, list, set)
- Commands (get)
- UI (respond, request)
- Update (check, download, install, available, progress, downloaded, error)
- Git (getBranch)
- Zoom (get, set, reset)
- Notification (settings, sound)

### 6. Preload API

**File:** `src/preload/index.ts`

Exposes `window.nekocode` with: `version`, `session`, `project`, `workspace`, `git`, `dialog`, `update`, `zoom`, `notification`

**No `window` API** for window controls.

---

## Implementation Plan

### Part 1: Make the Window Frameless

**File:** `src/main/index.ts` — Modify `createWindow()`

```typescript
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  frame: false,              // Remove native Windows title bar entirely
  icon: join(__dirname, '../../resources/icon.ico'),
  autoHideMenuBar: true,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false
  }
})
```

**Key Electron options:**

| Option | Effect |
|--------|--------|
| `frame: false` | Completely removes the native frame on Windows — no title bar, no min/max/close buttons, no window chrome |
| `titleBarStyle: 'hidden'` | On macOS, hides title text but keeps traffic light buttons; on Windows with `frame: false`, redundant but harmless |

> **Note:** `frame: false` alone is sufficient for Windows. On macOS, you may want `titleBarStyle: 'hidden'` instead to keep the traffic light buttons.

### Part 2: Add Window Control IPC Channels

#### 2a. Add Channel Constants

**File:** `src/shared/ipc-channels.ts`

```typescript
// Add to IPC_CHANNELS object:
WINDOW_MINIMIZE: 'window:minimize',
WINDOW_MAXIMIZE: 'window:maximize',
WINDOW_CLOSE: 'window:close',
WINDOW_IS_MAXIMIZED: 'window:is-maximized',
WINDOW_MAXIMIZE_CHANGE: 'window:maximize-change',
```

#### 2b. Add IPC Types

**File:** `src/shared/ipc-types.ts`

Add a `WindowAPI` interface and include it in `NekoCodeIPC`:

```typescript
export interface WindowAPI {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => (() => void)
}

// In NekoCodeIPC interface:
export interface NekoCodeIPC {
  // ... existing APIs ...
  window: WindowAPI
}
```

#### 2c. Expose Window API via Preload

**File:** `src/preload/index.ts`

```typescript
const windowApi: NekoCodeIPC['window'] = {
  minimize: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),

  maximize: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),

  close: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),

  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),

  onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, handler)
    }
  },
}

// Add to contextBridge.exposeInMainWorld:
contextBridge.exposeInMainWorld('nekocode', {
  // ... existing APIs ...
  window: windowApi,
})
```

#### 2d. Register Window IPC Handlers

**File:** `src/main/ipc-handlers.ts`

```typescript
// --- Window handlers ---
ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
  mainWindow?.minimize()
})

ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
  mainWindow?.close()
})

ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (): boolean => {
  return mainWindow?.isMaximized() ?? false
})
```

Also add event listeners in `createWindow()` (in `src/main/index.ts`) to notify the renderer when maximize state changes:

```typescript
// After creating the window:
mainWindow.on('maximize', () => {
  mainWindow.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, true)
})

mainWindow.on('unmaximize', () => {
  mainWindow.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, false)
})
```

### Part 3: Create Custom TitleBar Component

**New file:** `src/renderer/src/components/layout/TitleBar.tsx`

This replaces the NavBar. It provides:

- A **draggable region** (`-webkit-app-region: drag`) for moving the window
- App title "NekoCode" on the left
- Zoom controls in the middle area
- Custom **minimize**, **maximize/restore**, **close** buttons on the right
- Close button styled red on hover (Windows convention)

```tsx
import React, { useState, useEffect } from 'react'
import { useZoom } from '../../hooks/useZoom'

export function TitleBar() {
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
  const percentage = Math.round(zoom * 100)
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Check initial maximize state
    window.nekocode.window.isMaximized().then(setIsMaximized)
    // Listen for maximize/unmaximize changes
    return window.nekocode.window.onMaximizeChange(setIsMaximized)
  }, [])

  return (
    <header
      className="h-9 flex items-center bg-surface-950 border-b border-surface-800/50 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App title */}
      <span className="px-4 text-sm font-medium text-surface-400 font-mono">
        NekoCode
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom controls — no-drag so they're clickable */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={zoomOut}
          disabled={zoom <= minZoom}
          className="px-2 py-1 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom out (Ctrl+-)"
        >
          &minus;
        </button>
        <button
          onClick={resetZoom}
          className="px-2 py-1 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded min-w-[48px] text-center transition-colors"
          title="Reset zoom (Ctrl+0)"
        >
          {percentage}%
        </button>
        <button
          onClick={zoomIn}
          disabled={zoom >= maxZoom}
          className="px-2 py-1 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom in (Ctrl+=)"
        >
          +
        </button>
      </div>

      {/* Window controls — no-drag */}
      <div
        className="flex items-center ml-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          onClick={() => window.nekocode.window.minimize()}
          className="w-11 h-9 flex items-center justify-center hover:bg-surface-800/70 text-surface-400 hover:text-surface-200 transition-colors"
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={() => window.nekocode.window.maximize()}
          className="w-11 h-9 flex items-center justify-center hover:bg-surface-800/70 text-surface-400 hover:text-surface-200 transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            /* Restore icon: two overlapping rectangles */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8" rx="0.5" />
              <rect x="0" y="2" width="8" height="8" rx="0.5" />
            </svg>
          ) : (
            /* Maximize icon: single rectangle */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          onClick={() => window.nekocode.window.close()}
          className="w-11 h-9 flex items-center justify-center hover:bg-red-600 hover:text-white text-surface-400 transition-colors"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  )
}
```

### Part 4: Update App Layout

**File:** `src/renderer/src/App.tsx`

Restructure the layout to place TitleBar at the very top, above everything:

```tsx
// Before:
<div className="flex h-screen overflow-hidden bg-surface-950">
  <TreeSidebar />
  {state.activeView === 'settings' ? <SettingsView /> : <ChatView ... />}
</div>

// After:
<div className="flex flex-col h-screen overflow-hidden bg-surface-950">
  <TitleBar />
  <div className="flex flex-1 overflow-hidden">
    <TreeSidebar />
    {state.activeView === 'settings' ? <SettingsView /> : <ChatView ... />}
  </div>
</div>
```

### Part 5: Remove NavBar from ChatView

**File:** `src/renderer/src/components/chat/ChatView.tsx`

- Remove the `<NavBar />` usage (line ~218)
- Remove the `import { NavBar }` statement

### Part 6: Move Config Button to Sidebar Bottom

**File:** `src/renderer/src/components/layout/TreeSidebar.tsx`

Add a settings button at the very bottom of the sidebar. The sidebar is a flex column, so use `mt-auto` on a bottom section to push it down:

```tsx
{/* Bottom section — pinned to bottom of sidebar */}
<div className="mt-auto border-t border-surface-800/50 p-2">
  <button
    onClick={() => setActiveView('settings')}
    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-surface-400 hover:text-surface-100 hover:bg-surface-800/50 rounded transition-colors"
    title="Settings"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
    <span>Settings</span>
  </button>
</div>
```

### Part 7: Update Global Type Declarations

**File:** `src/renderer/src/global.d.ts`

Add the `window` API to the `nekocode` global type declaration:

```typescript
interface Window {
  nekocode: {
    // ... existing APIs ...
    window: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => (() => void)
    }
  }
}
```

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/main/index.ts` | **Modify** | Add `frame: false` to BrowserWindow; add maximize/unmaximize event listeners |
| `src/shared/ipc-channels.ts` | **Modify** | Add `WINDOW_MINIMIZE`, `WINDOW_MAXIMIZE`, `WINDOW_CLOSE`, `WINDOW_IS_MAXIMIZED`, `WINDOW_MAXIMIZE_CHANGE` |
| `src/shared/ipc-types.ts` | **Modify** | Add `WindowAPI` interface; add `window` to `NekoCodeIPC` |
| `src/preload/index.ts` | **Modify** | Expose `window` API (minimize, maximize, close, isMaximized, onMaximizeChange) |
| `src/main/ipc-handlers.ts` | **Modify** | Register window control IPC handlers |
| `src/renderer/src/components/layout/TitleBar.tsx` | **Create** | Custom draggable title bar with app name, zoom controls, and min/max/close |
| `src/renderer/src/App.tsx` | **Modify** | Add `<TitleBar />` at top; change layout to vertical flex |
| `src/renderer/src/components/chat/ChatView.tsx` | **Modify** | Remove `<NavBar />` import and usage |
| `src/renderer/src/components/layout/NavBar.tsx` | **Delete** (or keep for reference) | No longer needed after TitleBar replaces it |
| `src/renderer/src/components/layout/TreeSidebar.tsx` | **Modify** | Add settings button at the bottom of the sidebar using `mt-auto` |
| `src/renderer/src/global.d.ts` | **Modify** | Add `window` API type declaration |

---

## Important Considerations

### 1. Double-Click to Maximize

Electron automatically handles `dblclick` on `-webkit-app-region: drag` elements to toggle maximize/restore. No custom code needed.

### 2. Window Resizing with `frame: false`

With `frame: false`, the native Windows resize handles are removed. There are several approaches:

**Option A — Chromium built-in hit-testing (Recommended):**  
Modern Chromium on Windows 10/11 with `frame: false` still allows window resizing from the edges. The renderer process handles `WM_NCHITTEST` messages internally. This works out of the box in recent Electron versions without extra CSS or code.

**Option B — CSS borders for resize regions:**  
Add invisible border regions around the window edges that trigger resize cursor and behavior. More manual but gives full control.

**Option C — `titleBarOverlay` (Windows only):**  
Use `titleBarOverlay` option to keep native Windows snap layouts and resize handles while customizing button colors:

```typescript
const mainWindow = new BrowserWindow({
  frame: false,
  titleBarOverlay: {
    color: '#0a0a0f',        // matches bg-surface-950
    symbolColor: '#6b7280', // matches text-surface-400  
    height: 36
  }
})
```

This gives you the native Windows 11 snap layout + resize but still shows the Windows overlay buttons. **Not suitable** if you want fully custom buttons.

### 3. Sidebar Drag Region

When `frame: false`, the entire sidebar is part of the renderer window. If the TreeSidebar has empty space, users should be able to drag the window from there too. Consider adding `style={{ WebkitAppRegion: 'drag' }}` to the TreeSidebar's empty areas, with `no-drag` on interactive elements.

Alternatively, keep the TitleBar as the only drag region for simplicity.

### 4. macOS Compatibility

On macOS, the standard approach is `titleBarStyle: 'hidden'` which keeps the "traffic light" buttons (close, minimize, zoom) in the top-left corner. Consider platform detection:

```typescript
const isMac = process.platform === 'darwin'

const mainWindow = new BrowserWindow({
  frame: !isMac,
  titleBarStyle: isMac ? 'hidden' : undefined,
  // Only add custom window controls on non-macOS
})
```

### 5. Snap Layouts (Windows 11)

Windows 11's snap layout popup (triggered by hovering over the maximize button) does NOT work with custom HTML buttons. If you want snap layout support, you must use `titleBarOverlay` instead of fully custom buttons.

### 6. Shadow and Rounded Corners

On Windows 11, `frame: false` removes the rounded corners and shadow. To restore them, add:

```css
/* In global CSS */
html {
  border-radius: 8px;
  overflow: hidden;
}
```

And in the main process, you can use the `setBackgroundMaterial` API (Electron 30+) or DWM calls for Mica/Acrylic effects.

---

## Alternative Approaches

### Alternative A: `titleBarOverlay` Only (Partial Customization)

Instead of fully custom buttons, use Electron's `titleBarOverlay` to keep native Windows buttons but with custom colors:

```typescript
const mainWindow = new BrowserWindow({
  frame: false,
  titleBarOverlay: {
    color: '#0a0a0f',
    symbolColor: '#6b7280',
    height: 36
  }
})

// Still add -webkit-app-region: drag to the header
// but let Windows handle the min/max/close buttons
```

**Pros:** Snap layouts work, resize works, no IPC needed for window controls  
**Cons:** Can't fully customize button styles, no control over button layout

### Alternative B: `electron-titlebar` npm Package

Use an existing library like `custom-electron-titlebar` or `electron-titlebar` that handles all the edge cases.

**Pros:** Battle-tested, handles all platforms  
**Cons:** External dependency, may not match NekoCode's design language

### Alternative C: Only Remove NavBar, Keep Native Title Bar

Keep the native Windows frame but remove the custom NavBar entirely, relying on the native title bar for window controls.

**Pros:** Simplest change, no IPC needed  
**Cons:** Can't customize title bar appearance, config button still needs to move

---

## Recommended Implementation Order

1. Add IPC channels and handlers for window controls (Part 2)
2. Update preload and type declarations (Part 2)
3. Create TitleBar component (Part 3)
4. Update App.tsx layout (Part 4)
5. Remove NavBar from ChatView (Part 5)
6. Add config button to TreeSidebar bottom (Part 6)
7. Set `frame: false` on BrowserWindow (Part 1) — **do this last** so the app remains functional during development
8. Test: window dragging, resizing, minimize/maximize/restore, close, double-click to maximize
9. Run `bun run test`, `bun run lint`, `bun run type-check`, `bun run package:local`
