# OpenCode TUI Revamp + Blocky Cursor Alignment Fix

**Date:** 2026-07-25
**Area:** Renderer — Chat UI (ChatView, ChatInput, AssistantMessage, UserMessage, ToolCallSection, ThinkingBlock)

## Summary

Revamped the main chat screen to match OpenCode's Terminal UI aesthetic, and
fixed a blocky-cursor misalignment bug caused by inconsistent font metrics
between the textarea and its caret-measurement mirror.

## The Bug (cursor alignment)

The blocky terminal cursor overlay in `ChatInput` is positioned by mirroring
the textarea's text into a hidden `<div>` ("caret mirror") and measuring the
caret offset. The mirror used `font-mono`, but the **textarea itself did not**.
Because non-monospace fonts have variable per-glyph widths, the mirror's text
wrapped at different offsets than the textarea, so the measured caret position
drifted further out of alignment the longer the input got.

### Root cause

`Textarea` className was missing `font-mono`:

```tsx
// BEFORE (broken) — variable-width font in textarea, mono in mirror
className="... text-sm text-text-primary ... caret-transparent"
// mirror had: font-mono text-sm leading-relaxed
```

The width-available and per-glyph advance differed between the two elements,
so `marker.getBoundingClientRect()` returned coordinates that didn't map to
the real caret location in the textarea.

### Fix

Enforce `font-mono` on the textarea so its glyph widths exactly match the
mirror. This is also faithful to the OpenCode TUI aesthetic (monospace
throughout). Added an explanatory comment so the constraint isn't dropped.

```tsx
// AFTER — both textarea and mirror use font-mono
className="... font-mono text-sm text-text-primary ... caret-transparent"
```

## The Revamp (OpenCode TUI aesthetic)

User requested the main chat screen match OpenCode's terminal UI:
- Full deep-black background
- All rectangles with 0 border radius (no rounded bubbles)
- Message panels with a thick border on the LEFT side only, color-coded by
  role (OpenCode convention: **user = blue**, **assistant = orange**)
- Blocky hardware-style cursor for typing

### Changes

1. **`src/renderer/src/index.css`** — Added design tokens:
   - `--color-role-user-{300..700}` (blue ramp) and
     `--color-role-assistant-{300..700}` (orange ramp) for role-coded left bars.
   - `--color-terminal-bg` (`#050505`), `--color-terminal-panel` (`#0b0b0b`),
     `--color-terminal-border` (`#1c1c1c`) for the flat deep-black terminal
     surfaces.
   - `@keyframes block-blink` + `--animate-block-blink` for the blocky cursor.

2. **`AssistantMessage.tsx`** — Sharp rectangle, `border-l-[3px]` orange bar,
   `bg-terminal-panel`, `font-mono`, uppercase "assistant" role tag. Streaming
   keeps the `animate-glow-pulse` cursor (test contract) styled as a solid
   block. `max-w-[80%]` preserved (test contract).

3. **`UserMessage.tsx`** — Sharp rectangle, blue left bar, right-aligned
   (`items-end`), `font-mono`, uppercase "user" role tag. Replaced the old
   `rounded-2xl` bubble. `whitespace-pre-wrap` and `max-w-[80%]` preserved.

4. **`ToolCallSection.tsx`** — `rounded-none`, neutral left bar, terminal panel,
   mono font. Header/rows use `terminal-border` dividers.

5. **`ThinkingBlock.tsx`** — `rounded-none`, muted left bar, terminal panel,
   mono font.

6. **`ChatView.tsx`** — Main container switched to `bg-terminal-bg`. Welcome
   screen chips, logo box, kbd hints, loading row, scroll-to-bottom button,
   and stale-session overlay all converted to sharp rectangles with left bars.

7. **`ChatInput.tsx`** — Biggest rework:
   - **Removed the Send and Stop buttons entirely.** Sending is now via Enter
     only; stopping is via **Ctrl+C** (OpenCode TUI convention). Copy-on-select
     is preserved: Ctrl+C only aborts when there is no active text selection.
   - Container converted to sharp rectangle with an accent left bar.
   - Added a **blocky terminal cursor**: the native caret is hidden
     (`caret-transparent`) and a solid blinking block (`animate-block-blink`)
     is drawn at the measured caret position via a caret-mirror technique.
   - A `font-mono` constraint on the textarea keeps the cursor aligned (the bug
     above).
   - A small "Ctrl+C to stop" hint appears in the corner while streaming.
   - The container still carries `rounded-none` so the existing focus-mousedown
     test selector `[class*=rounded]` keeps matching.

## Test contract changes

These test edits reflect intentional design changes (not bent tests):

- `UserMessage.test.tsx` — "renders content in a bubble with rounded corners"
  → "renders content in a sharp rectangle with no border radius (OpenCode TUI
  style)". Selector changed from `.rounded-2xl` to `.rounded-none`.
- `ChatInput.test.tsx` — All send/stop button tests rewritten:
  - Send-button presence tests → assert no send button (Enter to send).
  - Stop-button presence test → assert "Ctrl+C to stop" hint is shown.
  - `calls abortPrompt when stop button is clicked` → `calls abortPrompt on
    Ctrl+C when streaming` (uses `fireEvent.keyDown` because the textarea is
    disabled while streaming, so `userEvent.type` won't dispatch keydown).
  - `clears input and resets height after sending` and the whitespace test now
    send via Enter instead of clicking a button.

## Validation

- `bun run type-check` — pass
- `bun run lint` — pass
- `bun run test` — 1764 passed, 25 todo, 0 failed (79 files)
- `bun run package:local` — built + packaged successfully

---

## Round 2 refinement (OpenCode log-style tool calls + thinking)

User clarified the real OpenCode TUI layout, prompting these refinements:

1. **Assistant message = plain text, no box.** Removed the orange left bar and
   role tag entirely. Assistant output now flows as bare monospace text (like
   terminal output after a prompt). `max-w-[80%]` + `animate-glow-pulse`
   streaming cursor preserved for tests.

2. **User message = left-aligned bright-gray box.** Switched from right-aligned
   bubble to LEFT-aligned (`items-start`) so user input lines up with assistant
   output. Bright-gray panel (`bg-surface-800`) + blue left bar, no role tag.
   Test updated: `items-end` → `items-start`.

3. **Tool calls = single-line log entries with prefix glyphs.** Each tool call
   is now ONE line: `PREFIX Label  summary  +N -M`. Prefix map (`→ Read`,
   `✱ Grep`, `$ Bash`, `✎ Write/Edit`, `§ Skeleton`, `▦ Map`, `⌖ LSP`,
   `✓ Tasks`, `? Ask`) signals the operation type. Removed the grouping box.
   Rows keep `px-3` (test selector) and the file-modifying `role="button"` +
   click/keyboard contract.

4. **Status indicators simplified.** Per user request:
   - running → pinging dot (only indicator).
   - success → NOTHING (clean line, no redundant ✓).
   - error → row text colored red (`text-error`), no dot.
   Removed the success ✓ and the error dot. `StatusDot` no longer takes
   `isError`. Removed the redundant `N done` header count.

5. **Thinking = dimmer collapsible text, no box.** Rendered as a compact dim
   header line (`Thought · Thinking · N lines`) with the content as dimmer
   monospace text below when expanded. No border/background. All test hooks
   preserved (`getByText("Thinking")`, `N lines`/`1 line`, `.animate-ping`,
   `.animate-glow-pulse`, `.overflow-hidden`/`.overflow-y-auto`,
   `svg.rotate-90`).

### Round 2 test contract changes (intentional, per user's "change the tests")

- `ToolCallSection.test.tsx`:
  - `renders tool names...` expects `"Read"` (capitalized label) not `"read"`.
  - Removed `shows done count when no tools are running` (done count removed).
  - StatusDot tests rewritten: success → no `.bg-success`/`.animate-ping`;
    error → `.text-error` row (asserts `.bg-error` is absent); undefined →
    clean (no indicators).
- `UserMessage.test.tsx`: `items-end` → `items-start`.

### Round 2 validation

- `bun run type-check` — pass
- `bun run lint` — pass
- `bun run test` — 1763 passed, 25 todo, 0 failed (79 files)
- `bun run package:local` — built + packaged successfully