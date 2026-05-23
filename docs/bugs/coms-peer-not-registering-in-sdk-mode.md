# Bug: Coms Peer Not Registering in SDK Mode

**Date:** 2026-05-23
**Status:** Fixed
**Severity:** High — NekoCode's SDK sessions never register as coms peers

---

## Summary

When NekoCode creates Pi agent sessions via the SDK, the coms extension's `session_start` handler fires but **never writes a registry entry**. As a result, NekoCode's SDK sessions are invisible to other Pi agents — they cannot be discovered or messaged via the coms system. Terminal-launched Pi sessions register perfectly.

## Root Cause

**`ElectronUIContext` was missing `setTheme()` and `setTitle()` methods.**

When the coms extension's `session_start` handler runs, the very first call is:

```typescript
applyExtensionDefaults(import.meta.url, ctx)
```

This calls `applyExtensionTheme()` which calls `ctx.ui.setTheme(themeName)`. Since `ElectronUIContext` doesn't have a `setTheme()` method, this throws:

```
TypeError: ctx.ui.setTheme is not a function
```

The handler's try/catch catches this error and **returns early** — the peer registration code that comes after never runs.

### The Full Chain

```
NekoCode creates SDK session
  → session.bindExtensions({ uiContext: ElectronUIContext })
  → emits "session_start" event
  → coms.ts handler runs
  → applyExtensionDefaults() calls ctx.ui.setTheme()
  → THROWS: "setTheme is not a function"
  → catch block runs, handler returns early
  → PEER REGISTRATION NEVER HAPPENS
  → No entry written to ~/.pi/coms/projects/<project>/agents/
```

### Why Terminal Works

The terminal uses `InteractiveUIContext extends BaseUIContext`, which has `setTheme`, `setTitle`, and all other UI context methods. The call succeeds, and the handler proceeds to bind a named-pipe endpoint and write the registry entry.

### Why It Was Invisible

- The coms extension IS loaded (worker logs confirm `[create] Extension: coms`)
- The `bindExtensions` call succeeds
- The registry directory `~/.pi/coms/projects/default/agents/` is **empty** — no entries written
- No coms errors are visible because: (1) the extension's catch block uses `ctx.ui?.notify?.()` which logs to a worker-internal logger, and (2) the extension runner has no `onError` listener, so errors are silently swallowed

## Fix

Added the missing methods to `ElectronUIContext` in `src/main/electron-ui-context.ts`:

### Critical Methods (directly caused the bug)

- **`setTheme(theme: string): { success: boolean }`** — Returns `{ success: true }` so extensions don't fall back to alternate themes. This was the method that threw TypeError and prevented peer registration.
- **`setTitle(title: string): void`** — No-op in Electron mode (BrowserWindow title managed separately). This was the second method that would have thrown if `setTheme` hadn't already failed.

### Additional Stub Methods (defensive — prevent future similar bugs)

These methods exist on `ExtensionUIContext` but were missing from `ElectronUIContext`. Added as safe no-ops to prevent other extensions from hitting the same TypeError pattern:

- `setWorkingMessage(message?: string)` — Logs the message
- `setWorkingVisible(visible: boolean)` — No-op
- `setWorkingIndicator(options?: WorkingIndicatorOptions)` — No-op
- `setHiddenThinkingLabel(label?: string)` — No-op
- `setWidget(key, content, options?)` — No-op
- `setFooter(factory)` — No-op
- `setHeader(factory)` — No-op
- `custom<T>(factory)` — Returns `undefined`
- `pasteToEditor(text)` — No-op
- `setEditorText(text)` — No-op
- `getEditorText()` — Returns empty string
- `editor(title, prefill?)` — Falls back to `input()` dialog
- `addAutocompleteProvider(factory)` — No-op
- `setEditorComponent(factory)` — No-op
- `getEditorComponent()` — Returns `undefined`
- `getToolsExpanded()` — Returns `false`
- `setToolsExpanded(expanded)` — No-op
- `getAllThemes()` — Returns empty array
- `getTheme(name)` — Returns `undefined`
- `theme` getter — Returns `undefined`

## Files Changed

- **`src/main/electron-ui-context.ts`** — Added `setTheme()`, `setTitle()`, and 19 other stub methods. Updated import to include `ExtensionWidgetOptions`, `WorkingIndicatorOptions`, `AutocompleteProviderFactory`.
- **`src/tests/main/electron-ui-context.test.ts`** — Added 15 new test cases covering all new methods, with explicit comments linking `setTheme()`/`setTitle()` to the coms peer registration bug.

## Verification

- `bun run type-check` — Passes
- `bun run lint` — Passes
- `bun run test` — All 32 ElectronUIContext tests pass (15 new), 1389 total tests pass
  - (1 pre-existing failure in `WelcomeScreen.test.tsx` unrelated to this change)

## Manual Verification Steps

1. Start NekoCode and create an SDK session
2. Check `~/.pi/coms/projects/default/agents/` for a new `.json` file — it should now appear
3. From a Pi CLI agent, run `coms_list` — NekoCode's session should appear as a discoverable peer
4. Send a message from another Pi agent to NekoCode — it should be received
5. Check worker logs — no more TypeError from `setTheme`/`setTitle`
