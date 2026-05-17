# Custom Titlebar & Frameless Window Implementation

**Date:** 2026-05-17
**Type:** Feature Implementation
**Status:** Complete

## Problem

NekoCode was using the default OS window frame (title bar with minimize/maximize/close buttons). This created a visual disconnect between the native window chrome and the custom dark-themed application UI. The native title bar did not match the application's dark theme and could not display custom UI elements.

## Solution

Implemented a frameless window with window controls merged directly into the existing NavBar row, sitting at the **same Y level** as the pink NekoCode logo. The layout is a single top bar: left = sidebar header (NekoCode logo + add-project button), right = zoom controls + window control buttons.

```
+------------------+------------------------------------------+
| NekoCode v0.2.52 |     [spacer]  [- 100% +]  [min max cls] |
|  [+]             |                                          |
+------------------+------------------------------------------+
| TreeSidebar      |  ChatView / SettingsView                 |
|  project list    |                                          |
|  ...             |                                          |
|  Settings        |                                          |
+------------------+------------------------------------------+
```

## Changes Made

### 1. IPC Layer (Shared)

**`src/shared/ipc-channels.ts`** - Added window control IPC channels:
- `WINDOW_MINIMIZE`: Minimize the window
- `WINDOW_MAXIMIZE`: Toggle maximize/restore
- `WINDOW_CLOSE`: Close the window
- `WINDOW_IS_MAXIMIZED`: Query current maximize state
- `WINDOW_MAXIMIZED_STATE`: Event channel for maximize state changes

**`src/shared/ipc-types.ts`** - Added `WindowApi` interface:
- `minimize()`, `maximize()`, `close()`, `isMaximized()`: Promise-based IPC calls
- `onMaximizedStateChange()`: Subscribe to maximize/unmaximize events from main process
- Added `window: WindowApi` to `NekoCodeIPC` interface

### 2. Preload Layer

**`src/preload/index.ts`** - Exposed window control APIs:
- All 5 window API methods bridged through `ipcRenderer.invoke()` and `ipcRenderer.on()`
- Proper cleanup via `removeListener()` in the `onMaximizedStateChange` unsubscribe function

### 3. Main Process

**`src/main/index.ts`** - Window configuration changes:
- Set `frame: false` on BrowserWindow to remove native title bar
- Added IPC_CHANNELS import for event forwarding
- Forward `maximize` and `unmaximize` events to renderer via `webContents.send()`
- Guarded with `isDestroyed()` checks to prevent crashes on closing

**`src/main/ipc-handlers.ts`** - Added window control IPC handlers:
- `WINDOW_MINIMIZE`: Calls `win.minimize()`
- `WINDOW_MAXIMIZE`: Toggles between `win.maximize()` and `win.unmaximize()`
- `WINDOW_CLOSE`: Calls `win.close()`
- `WINDOW_IS_MAXIMIZED`: Returns `win.isMaximized()`
- All handlers use `BrowserWindow.getFocusedWindow()` with safety checks

### 4. Renderer Components

**`src/renderer/src/components/layout/NavBar.tsx`** - Merged with sidebar header:
- Left section (w-60): NekoCode pink/white logo + version + add-project button (moved from TreeSidebar header)
- Right section (flex-1): zoom controls + window control buttons (minimize, maximize/restore, close)
- Entire bar is a native drag region via `-webkit-app-region: drag`
- Interactive elements (buttons) use `-webkit-app-region: no-drag`
- Maximize/restore button dynamically changes icon based on `isMaximized` state via IPC events
- Close button gets red hover background to signal destructive action
- Add-project button uses `addProject` from project store (same flow as before)

**`src/renderer/src/components/layout/TreeSidebar.tsx`** - Extracted header:
- Removed the header div (NekoCode logo + add-project button) - now in NavBar
- Removed unused `handleAddProject` function and `addProject` from destructured store methods
- Removed unused `declare const __APP_VERSION__` (now declared in global.d.ts)
- Changed `h-screen` to `h-full` to fix sidebar overflow/clipping below the NavBar
- Settings gear button remains at the bottom of the sidebar

**`src/renderer/src/components/chat/ChatView.tsx`** - Removed NavBar:
- NavBar moved from ChatView to App level (persists across all views)

**`src/renderer/src/App.tsx`** - Updated layout:
- NavBar is the first child (spanning full width above sidebar + content)
- Wrapped sidebar and content in a `flex flex-1 min-h-0` container

**`src/renderer/src/components/layout/TitleBar.tsx`** - DELETED:
- Initial implementation had a separate titlebar; replaced by merging controls into NavBar

### 5. Type Declarations

**`src/renderer/src/global.d.ts`** - Added `__APP_VERSION__` declaration:
- Moved from TreeSidebar's local `declare const` to global declaration
- Needed because NavBar now uses `__APP_VERSION__` (injected by electron-vite define)

### 6. Test Infrastructure

**`src/tests/__utils__/test-utils.tsx`** - Updated mock IPC:
- Added `window` property to `createMockIPC()` with all WindowApi methods mocked

**`src/tests/shared/ipc-channels.test.ts`** - Updated channel count and key list:
- Updated expected channel count from 37 to 42
- Added 5 window channel keys to the expected key list
- Added window channels naming convention test

## Key Design Decisions

1. **Same Y level as NekoCode logo** over separate bar: User explicitly requested window controls at the same row as the pink NekoCode logo, not in a separate bar above it.

2. **CSS `-webkit-app-region: drag`** on NavBar: Uses Electron's built-in frameless window drag support for native-feeling window movement (including double-click to maximize).

3. **Event-based maximize state** over polling: The main process forwards `maximize`/`unmaximize` events to the renderer reactively.

4. **NavBar at App level** over inside ChatView: The NavBar persists across all views (chat, settings), providing consistent window controls and zoom.

5. **Settings in sidebar** over NavBar: The settings button is at the TreeSidebar bottom, keeping it accessible without crowding the NavBar.

6. **`h-full` instead of `h-screen`** on sidebar: Since the NavBar takes space above, the sidebar must use `h-full` to fill available flex space, preventing the settings button from being clipped.

7. **Global `__APP_VERSION__`** declaration: Moved from TreeSidebar's local `declare const` to the global.d.ts file, since NavBar now needs access to it.

## Testing

All validation checks pass:
- `bun run type-check` - Clean
- `bun run lint` - Clean
- `bun run test` - All tests pass
- `bun run package:local` - Build + package succeeds

## Files Changed

- `src/shared/ipc-channels.ts` (5 new channels)
- `src/shared/ipc-types.ts` (1 new interface, 1 extended interface)
- `src/preload/index.ts` (1 new API section)
- `src/main/index.ts` (frame:false, maximize event forwarding)
- `src/main/ipc-handlers.ts` (5 new handlers)
- `src/renderer/src/components/layout/NavBar.tsx` (rewritten: NekoCode header + drag region + window controls)
- `src/renderer/src/components/layout/TreeSidebar.tsx` (header extracted, h-full fix, cleanup)
- `src/renderer/src/components/chat/ChatView.tsx` (NavBar removed from ChatView)
- `src/renderer/src/App.tsx` (layout restructured with NavBar at top)
- `src/renderer/src/index.css` (removed old titlebar CSS)
- `src/renderer/src/global.d.ts` (added `__APP_VERSION__` global)
- `src/renderer/src/components/layout/TitleBar.tsx` (DELETED)
- `src/tests/__utils__/test-utils.tsx` (mock update)
- `src/tests/shared/ipc-channels.test.ts` (updated channel expectations)
