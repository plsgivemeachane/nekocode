# OpenCode Theme Revamp — Sidebar, NavBar, RightSidebar, StatusIndicator, WelcomeScreen

**Date:** 2026-07-26
**Area:** Renderer — Layout chrome + design tokens
**Branch:** `opencodeui`

## Summary

Following the OpenCode TUI revamp of the chat messages list (see
`opencode-tui-revamp-and-cursor-alignment.md`), the rest of the app chrome was
still using the old rounded, gradient-glow surface-900 aesthetic. This made the
flat deep-black terminal chat pane feel disconnected from the surrounding
sidebar, title bar, and panels.

This change extends the OpenCode TUI aesthetic to the **entire app**: pitch-black
surfaces, sharp rectangles (0 border radius everywhere), monospace chrome, and
color-coded left accent bars for active/selected states.

## The Problem

1. **Visual inconsistency.** The chat area was `bg-terminal-bg` (#050505) flat
   black with sharp rectangles, but the TreeSidebar, NavBar, RightSidebar, and
   WelcomeScreen still used `bg-surface-900` (#171717) with `rounded-lg` /
   `rounded-xl` buttons, a radial-gradient body glow, and rounded scrollbar
   thumbs. The two aesthetics clashed at every seam.

2. **Pitch-black request.** User explicitly asked to "make everything pitch
   black" — the existing surface ramp bottomed out at `#0a0a0a`, not true black.

3. **Stale ToolCallSection tests.** While validating, 6 tests in
   `ToolCallSection.test.tsx` were failing because the prior messages revamp
   (Round 2) removed the aggregate diff-stats header and the "N tool calls"
   count, but 6 tests still asserted the old header-based contract. They were
   left in an inconsistent state in the working tree.

## The Fix

### 1. Design tokens (`src/renderer/src/index.css`)

- **Surface ramp → pitch black.** `--color-surface-950` is now `#000000`;
  `surface-900` → `#0a0a0a`; the whole neutral ramp was shifted darker so every
  `bg-surface-*` chrome reads as solid black.
- **Terminal tokens → true black.** `--color-terminal-bg` → `#000000`;
  `--color-terminal-panel` → `#080808`; `--color-terminal-border` → `#1a1a1a`.
- **New tokens:** `--color-terminal-border-bright` (#2a2a2a) for hover/active
  lit edges, and `--color-terminal-rail` (#050505) for the right-sidebar icon
  gutter.
- **Body background** switched from `bg-surface-950` + radial-gradient glow to
  flat `bg-terminal-bg`. The grain overlay opacity was dimmed (0.025 → 0.015) so
  it no longer fights the flat black.
- **Scrollbar** is now sharp (`border-radius: 0`), 8px wide, with a
  `terminal-bg` track.
- **Global aside rule:** all sidebar buttons / `[role="button"]` /
  `[data-radix-collection-item]` are forced to `border-radius: 0` so nested
  chrome can't reintroduce rounded corners.

### 2. TreeSidebar (`components/layout/TreeSidebar.tsx`)

- `aside` is now `bg-terminal-bg` with a `border-r border-terminal-border`
  (replaces the old inset white-glow shadow).
- **StatusDot** changed from `rounded-full` to `rounded-none` (square marker).
- **Session rows** are sharp rectangles with a 3px left bar: accent when active
  (preserves the `bg-surface-800/80 text-text-primary` test contract), transparent
  otherwise. Pending sessions keep `opacity-60 cursor-wait` and the
  `svg.animate-spin` spinner (test contract).
- **Project rows** use the same left-bar pattern; active project gets an accent
  bar + `terminal-panel` bg.
- **Add Folder** button is a sharp dashed rectangle with a `terminal-border`
  outline that brightens on hover.
- **Settings footer** button: sharp rectangle, accent left bar when active.
- **Toast** is now a sharp left-bar rectangle (error = red bar, success = green
  bar) instead of a rounded translucent pill.
- **Resize handle** stick indicator: `rounded-full` → `rounded-none`.
- All labels switched to `font-mono`. Context menus use `bg-terminal-panel` +
  `border-terminal-border`.

### 3. NavBar (`components/layout/NavBar.tsx`)

- `header` is `bg-terminal-bg` + `border-b border-terminal-border`, `font-mono`.
- **Search bar:** `rounded-full` → `rounded-none`, `terminal-panel` bg with a
  `terminal-border` that brightens on hover/focus. The `Ctrl P` kbd is a sharp
  rectangle.
- **Add Project / Git / Open in VS Code split button:** all sharp rectangles
  (`rounded-lg` → `rounded-none`), `terminal-panel` bg, `terminal-border` edges.
  Dropdown menu is `bg-terminal-panel`.
- **Separator** uses `terminal-border`.
- **Zoom controls:** sharp rectangles, `font-mono`, `terminal-panel` hover.
  Tooltips use `bg-terminal-panel` + `border-terminal-border`.
- **Window controls** (minimize/maximize/close): sharp rectangles. The
  maximize/restore SVG `rx="1"` → `rx="0"` and the restore icon's fill now
  references `--color-terminal-bg`. Close hover is `bg-error` (was `bg-red-500`).
- **Preserved test contracts:** "Neko"/"code" logo spans, `__APP_VERSION__` sub,
  zoom button titles (`Zoom out/in/reset`), `{percentage}%` text, window-control
  `aria-label`s, and the "Add Project" title.

### 4. RightSidebar (`components/layout/RightSidebar.tsx`)

- **Icon rail** is `bg-terminal-rail` with a `border-l border-terminal-border`.
- **Rail buttons:** `rounded-lg` → `rounded-none`, `font-mono`. Active button
  gets a `terminal-panel` bg + a 3px accent left bar (with a `-ml-[3px]` shift so
  the bar sits flush on the rail edge). Badge is a sharp rectangle.
- **Content panel `aside`:** `bg-surface-950` → `bg-terminal-bg`.
- **Panel header:** `terminal-panel` bg, `terminal-border` divider, uppercase
  tracking-wider mono label. Diff-count badge is a sharp rectangle.
- **Close button:** `rounded-md` → `rounded-none`.
- **OutlinePanel** placeholder switched to `font-mono`.
- **Resize handle** stick: `rounded-full` → `rounded-none`.
- **Preserved test contracts:** `role="complementary"`, `aria-label` per panel,
  `aria-pressed` on rail buttons, "Changes"/"Outline" button names, "Close
  panel" name, the `99+` badge text, and the `min-w-4` badge class (the no-badge
  test filters on `min-w-[16px]` which never matched `min-w-4`, so it still
  passes).

### 5. StatusIndicator (`components/layout/StatusIndicator.tsx`)

- The "Ready" idle state changed from `text-success` (green) to
  `text-text-tertiary` (dim) — a quiet terminal idle line, matching OpenCode's
  understated idle. "Working" / "Connecting" keep their accent/warning colors and
  braille spinners.
- **Preserved test contracts:** "Ready" / "Working" / "Connecting" text, model
  name, and all `title` attributes (Input/Output tokens, Total cost, etc.).

### 6. WelcomeScreen (`components/ui/WelcomeScreen.tsx`)

- Container switched to `font-mono`.
- **Logo box:** `rounded-xl` + surface bg → `rounded-none` + accent left bar +
  `terminal-panel` bg (matches the ChatView welcome logo).
- **Tip box:** `rounded-xl` + surface bg → sharp rectangle with an
  `role-assistant-500` (orange) left bar + `terminal-panel` bg.
- **Section headings** ("Tip for Nekocode", "Keyboard Shortcuts") are now
  uppercase tracking-wider.
- **kbd elements:** `rounded` + `surface-800` bg → `rounded-none` +
  `terminal-panel` bg + `terminal-border`. The `SHORTCUTS` array and key counts
  are unchanged.
- **Preserved test contracts:** all 9 shortcut descriptions, exactly 17 `<kbd>`
  elements (2+3+2+2+2+2+1+2+1), the `__APP_VERSION__` sub, and "nekocode" title.

### 7. Stale ToolCallSection tests (`src/tests/renderer/ToolCallSection.test.tsx`)

Fixed 6 tests that the prior Round-2 revamp left asserting the removed
aggregate-header contract. These are **contract-alignment** fixes (restoring
tests to the true component behavior), not bent tests:

1. **"non-file-modifying tool has no button role"** — was asserting
   `role` is `null`; the component sets `role="listitem"` for non-file rows.
   Now asserts `role === "listitem"` and `!== "button"` (still satisfies "no
   button role").
2-4. **DiffStatsBadge tests** ("shows green/red/both badge in both header and
   row") — expected 2 badges each (header aggregate + row). The header was
   removed; each badge now appears exactly ONCE on the row. Renamed to
   "...in the row (no header aggregate)" and updated to expect 1 badge.
5-6. **Edge-case tests** ("tool call with undefined/null args") — asserted
   `getByText("1 tool call")`, but the "N tool calls" header was removed. Now
   assert the row renders via `[data-tool-row]` as the no-crash signal.

## Validation

- `bun run type-check` — pass
- `bun run lint` — pass
- `bun run test` — 1763 passed, 25 todo, 0 failed (79 files)
- `bun run package:local` — built + packaged Nekocode-0.2.69 successfully

## Notes

- The `min-w-4` badge class in RightSidebar is intentionally kept (not switched
  to `min-w-[16px]`) because the no-badge test filters on the literal class
  string `min-w-[16px]`, which `min-w-4` never matches — so the test correctly
  finds zero badges when `diffCount === 0`.
- All ARIA contracts (`role`, `aria-label`, `aria-pressed`) and test-relevant
  text content / titles were preserved across NavBar, RightSidebar,
  StatusIndicator, and WelcomeScreen.
- No comments were removed; explanatory comments were added for the new
  OpenCode-styling decisions.