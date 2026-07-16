# Search Palette Tabs Broken — cmdk Built-in Filter Conflict

**Date:** 2026-06-10
**Status:** Fixed
**Severity:** High — core search feature non-functional

## Bug Description

The Search Palette (Ctrl+K / Ctrl+Shift+P) had broken tab behavior:

1. **All tab** — Only showed commands, never showed files or sessions
2. **Commands tab** — Showed nothing at all
3. **Files tab** — Showed "Type to search commands, files, and sessions" but search found nothing
4. **Sessions tab** — Same as Files tab

## Root Cause

The `SearchPalette` component uses the `cmdk` library (via shadcn/ui `CommandDialog`) for keyboard navigation and rendering. The `cmdk` library has a **built-in search filter** that automatically filters `CommandItem` children based on the `CommandInput` value.

In `SearchPalette`, the input value (`rawInput`) includes mode prefix characters:
- `> ` for Commands mode
- `@ ` for Files mode
- `: ` for Sessions mode

The `SearchPalette` implements its **own custom filtering** via:
- `useSearchMode` — detects the mode from the prefix
- `useSearchFiles` — searches files via IPC
- `useSearchSessions` — searches sessions from project store
- `filteredCommands` — filters commands by query

However, **cmdk's built-in filter was still active**, applying a second layer of filtering on top of the custom filtering. Since cmdk tried to match `rawInput` (e.g., `> mycommand` or `@ myfile.ts`) against `CommandItem` `value` props, no items ever matched because:

- No command value starts with `> `
- No file path value starts with `@ `
- No session value starts with `: `

This double-filtering caused:
- **All tab**: Only commands appeared when typing without a prefix (because `rawInput` matched command values), but files/sessions never appeared
- **Commands tab**: When switching to Commands tab, `rawInput` becomes `> `, which no command matches
- **Files/Sessions tabs**: Same prefix mismatch issue

## Fix

Two changes were made:

### 1. `src/renderer/src/components/ui/command.tsx`

Added a `filter` prop to `CommandDialog` that passes through to the inner `Command` component:

```tsx
function CommandDialog({
  // ...existing props
  /** Optional custom filter function to override cmdk's built-in search filtering */
  filter,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  // ...existing types
  /** Optional custom filter function to override cmdk's built-in search filtering */
  filter?: (value: string, search: string) => number
}) {
  return (
    <Dialog {...props}>
      {/* ... */}
      <Command filter={filter} className={...}>
        {children}
      </Command>
    </Dialog>
  )
}
```

### 2. `src/renderer/src/components/chat/SearchPalette.tsx`

Passed a no-op filter to `CommandDialog` that bypasses cmdk's built-in filtering:

```tsx
<CommandDialog
  // ...existing props
  // Bypass cmdk's built-in search filtering — we do our own filtering
  // via useSearchMode, useSearchFiles, useSearchSessions, and filteredCommands.
  // Without this, cmdk would try to match the raw input (including prefix
  // characters like >, @, :) against item values, hiding all results.
  filter={() => 1}
>
```

The `filter={() => 1}` function tells cmdk that every item matches with rank 1, effectively disabling its built-in search. Since `SearchPalette` handles all filtering itself, this is the correct behavior.

### 3. `src/tests/renderer/ChatView.test.tsx`

Updated placeholder text assertions from `/search commands/i` to `/search/i` to match the new SearchPalette placeholder text ("Search... (prefix with > @ : to filter by mode)").

## Files Changed

- `src/renderer/src/components/ui/command.tsx` — Added `filter` prop passthrough to `CommandDialog`
- `src/renderer/src/components/chat/SearchPalette.tsx` — Added `filter={() => 1}` to bypass cmdk filtering
- `src/tests/renderer/ChatView.test.tsx` — Updated placeholder text assertions

## Lesson Learned

When using `cmdk` (Command) with custom filtering logic, always pass a `filter` prop to override the built-in search behavior. Otherwise, cmdk will apply its own string-matching filter on top of your custom logic, causing items to be hidden even when your custom logic says they should be visible.
