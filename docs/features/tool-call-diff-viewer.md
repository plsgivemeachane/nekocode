# Tool Call Diff Viewer

> **Status:** Planned | **Priority:** Medium | **Dependencies:** `@pierre/diffs` (already installed)

## Summary

Show inline line-count stats in tool call rows for file-mutation tools (edit, write), and render the actual accumulated diffs in a new **Side Panel** that slides out from the right edge of the chat. The Side Panel is collapsed by default (only icon rail visible) and acts as a general-purpose "activity sidebar" — its first and currently only mode is **Session Diff View**, which aggregates all file edits from the current AI turn into a scrollable, syntax-highlighted diff.

## Design Direction

**Aesthetic:** Utilitarian-editor — match NekoCode's existing dark, dense, information-forward UI. No decorative gradients or "AI vibes". Think: terminal-adjacent, monospace-first, surface-level depth cues. The side panel should feel like a tool drawer that slides out on demand — functional, not flashy.

**Key UX principles from make-interfaces-feel-better:**
- **Concentric border radius** — outer panel radius = inner component radius + padding
- **Shadows over borders** — layered `box-shadow` with transparency for the panel, not hard borders
- **Interruptible animations** — CSS transitions for the panel slide (can be interrupted mid-open/close)
- **Scale on press** — `scale(0.96)` on icon buttons for tactile feedback
- **Tabular numbers** — `font-variant-numeric: tabular-nums` on the `+N -N` diff stats (they update dynamically)
- **Subtle exit animations** — panel closes with a small `translateX`, not a dramatic sweep
- **Minimum hit area** — 40×40px on all icon buttons in the collapsed rail

---

## What Changes — User-Facing Behavior

### 1. Inline Line-Count Stats in Tool Rows

Currently, tool call rows show:
```
● edit     src/foo.ts
```

After this change, **edit** and **write** rows show line change counts:
```
● edit     src/foo.ts     +12 -3
● write    src/bar.ts     +45
```

- **edit tool:** Show additions AND deletions (computed from `edits[].oldText` vs `edits[].newText`)
- **write tool:** Show additions only (since write = full file replacement, or new file creation)
- Format: `+N -N` for edits, `+N` for writes. Uses `tabular-nums` for stable width.
- Colors: additions in `text-green-400`, deletions in `text-red-400` (matching git convention)
- Only shown when the tool is `done` — running tools show no stats yet

### 2. Side Panel (Activity Rail)

A new **Activity Rail** is added to the right edge of the chat area. It has two states:

| State | Width | Content |
|-------|-------|---------|
| **Collapsed** | 44px | Vertical icon strip — currently one icon: diff viewer icon |
| **Expanded** | ~420px (configurable, min 320px) | Full side panel content — currently: Session Diff View |

**Collapsed state behavior:**
- Single column of icon buttons, right-aligned, each 40×40px hit area
- Icons: diff-viewer (document-with-plus icon), more icons added in future
- Active icon has a subtle `bg-accent/15` highlight + `border-l-2 border-accent`
- Hover: `bg-surface-800/50` with `scale(0.96)` on press

**Expanded state behavior:**
- Panel slides in from the right with `transition: transform 200ms cubic-bezier(0.2, 0, 0, 1)` (interruptible)
- Panel has a drag handle / resize grip on the left edge for width adjustment (future, not Phase 1)
- Panel header: mode title ("Session Diffs") + close button
- Panel body: content for the active mode

**Mode: Session Diff View**
- Shows all file mutations from the current AI response as a single scrollable diff
- Uses `CodeView` from `@pierre/diffs/react` to render multiple files in a virtualized list
- Each file section shows: file path, `+N -N` stats, syntax-highlighted diff
- Accumulates edits across multiple tool calls in the same response (e.g., if edit is called twice on the same file, diffs merge)
- Clicking a tool call row in the chat highlights/scrolls-to the corresponding file in the side panel

**How to open the diff panel:**
1. Click the diff icon in the collapsed Activity Rail
2. Click on any tool call row that has diffs (edit/write) — opens panel AND scrolls to that file
3. Keyboard shortcut: `Ctrl+Shift+D` (future, not Phase 1)

---

## Architecture

### Layout Structure

```
┌──────────┬────────────────────────────────┬──────────┐
│ Tree     │ ChatView                       │ Activity │
│ Sidebar  │                                │ Rail     │
│          │  ┌─ NavBar ──────────────────┐ │          │
│          │  │                            │ │ [icon]   │
│          │  ├─ Messages ────────────────┤ │ [icon]   │
│          │  │                            │ │          │
│          │  │  ● edit foo.ts  +12 -3    │ │ ┌──────┐ │
│          │  │  ● write bar.ts +45       │ │ │Diff  │ │
│          │  │                            │ │ │Panel │ │
│          │  │                            │ │ │      │ │
│          │  ├─ ChatInput ───────────────┤ │ │      │ │
│          │  │                            │ │ └──────┘ │
│          │  └────────────────────────────┘ │          │
└──────────┴────────────────────────────────┴──────────┘
```

The Activity Rail lives INSIDE the ChatView component, not at the App level. This keeps it scoped to the chat context and avoids layout complexity with the settings view.

### Component Tree

```
ChatView
├── MessagesTimeline
│   ├── UserMessage
│   ├── AssistantMessage
│   │   ├── ToolCallGroup  ← UPDATED: shows +N -N stats
│   │   ├── ThinkingBlock
│   │   └── MarkdownContent
│   └── ...
├── ChatInput
└── ActivityRail  ← NEW
    ├── CollapsedRail  ← icon strip
    └── ExpandedPanel  ← when open
        ├── PanelHeader
        └── SessionDiffView  ← NEW: uses @pierre/diffs CodeView
```

---

## Phase 1: Inline Diff Stats

### Changes to `extractToolSummary()` (`tool-summary.ts`)

Add a new export function `extractDiffStats()` that returns line change counts:

```ts
interface DiffStats {
  additions: number
  deletions: number
}

export function extractDiffStats(toolName: string, args: unknown, result?: unknown): DiffStats | null {
  const short = toolName.replace(/^toolcall_/, '')
  if (short === 'edit') {
    const a = args as { edits: Array<{ oldText: string; newText: string }> }
    let additions = 0, deletions = 0
    for (const edit of a.edits ?? []) {
      const oldLines = edit.oldText.split('\n').length
      const newLines = edit.newText.split('\n').length
      if (newLines > oldLines) additions += newLines - oldLines
      else deletions += oldLines - newLines
      // Note: this is a simplified count. For precise add/delete counts,
      // we'd need a diff algorithm, but line-count delta is good enough for the row display.
    }
    return { additions, deletions }
  }
  if (short === 'write') {
    const a = args as { content: string }
    const lines = (a.content ?? '').split('\n').length
    return { additions: lines, deletions: 0 }
  }
  return null
}
```

### Changes to `ToolCallRow` (`ToolCallSection.tsx`)

Add diff stats display after the summary text:

```tsx
function ToolCallRow({ toolName, status, isError, summary, diffStats }: {
  toolName: string
  status: 'running' | 'done'
  isError?: boolean
  summary: string
  diffStats?: DiffStats | null  // NEW
  onClick?: () => void          // NEW — opens side panel to this file
}) {
  const shortName = toolName.replace(/^toolcall_/, '')

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-[5px] hover:bg-surface-800/30 transition-colors cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <StatusDot status={status} isError={isError} />
      <span className="text-[12px] font-mono font-medium text-text-secondary w-[88px] shrink-0 truncate">
        {shortName}
      </span>
      <span className="text-[12px] font-mono text-text-tertiary truncate flex-1 min-w-0">
        {summary}
      </span>
      {diffStats && status === 'done' && (
        <span className="text-[11px] font-mono tabular-nums shrink-0 flex items-center gap-1">
          <span className="text-green-400">+{diffStats.additions}</span>
          {diffStats.deletions > 0 && (
            <span className="text-red-400">-{diffStats.deletions}</span>
          )}
        </span>
      )}
    </div>
  )
}
```

### Data Flow

`ChatView` already has access to `AssistantToolCallMessage` which includes `args` and `result`. Need to:
1. Pass `result` through to `ToolCallGroup` (currently only `args` is passed)
2. Compute `diffStats` per tool call in `ToolCallGroup`
3. Pass `diffStats` and `onClick` handler to `ToolCallRow`

---

## Phase 2: Activity Rail + Session Diff View

### New Components

#### `ActivityRail` (`components/chat/ActivityRail.tsx`)

The collapsible side panel container. Owns the expanded/collapsed state.

```tsx
interface ActivityRailProps {
  sessionId: string
  /** Tool calls from the current response to show diffs for */
  toolCalls: AssistantToolCallMessage[]
}

interface RailMode {
  id: string
  icon: React.ReactNode
  label: string
  isActive: boolean
}
```

**Collapsed render:** Vertical icon strip (44px wide), each icon 40×40px.
**Expanded render:** Full panel with header + mode content.

**Animation:** CSS `transform: translateX(100%)` ↔ `translateX(0)` with 200ms `cubic-bezier(0.2, 0, 0, 1)`. The collapsed rail is always visible; the expanded panel slides over/adjacent to it.

#### `SessionDiffView` (`components/chat/SessionDiffView.tsx`)

Takes an array of tool call messages, accumulates their diffs, and renders via `@pierre/diffs`.

```tsx
interface SessionDiffViewProps {
  toolCalls: AssistantToolCallMessage[]
  /** Scroll to this file path when it changes */
  highlightFile?: string
}
```

**Diff accumulation logic:**
1. Filter to only `edit` and `write` tool calls
2. Group by file path
3. For each file, accumulate changes in order:
   - For **edit**: apply each edit's oldText→newText to build the accumulated diff
   - For **write**: the full file content is the "new" state; if we have `result.previousContent`, diff against that; otherwise treat as all-additions
4. Generate a unified diff patch string per file
5. Concatenate patches and pass to `CodeView` from `@pierre/diffs/react`

**Why CodeView instead of PatchDiff:** `CodeView` renders multiple files in a virtualized list with per-file headers. Perfect for showing all changed files from one AI response. `PatchDiff` only handles a single patch.

### Write Tool — Getting Previous Content

Same approach as the old plan — the main process `write` handler should return `{ previousContent: string | null }` in its result. This requires an IPC change:

**Main process change** (`ipc-handlers.ts`):
- In the `write` tool handler, before writing the file, read it with `fs.readFile`
- Return `{ previousContent: string | null }` as part of the tool result
- This is the cleanest approach — no git dependency, no guessing

### @pierre/diffs Usage

Same configuration as the existing `DiffViewer.tsx`:
- `theme: 'pierre-dark'`, `themeType: 'dark'`
- `disableWorkerPool` (Electron compatibility)
- `lineDiffType: 'word'` for word-level highlights
- `diffStyle: 'unified'` (split is heavy for multi-file view)

But using `CodeView` instead of `PatchDiff`:
```tsx
import { CodeView } from '@pierre/diffs/react'

<CodeView
  files={diffFiles}  // Array of { path, patch } objects
  options={diffOptions}
  disableWorkerPool
  className="session-diff-root"
/>
```

### ChatView Integration

The `ChatView` component needs to:
1. Add `ActivityRail` as a sibling to the messages area
2. Track the current response's tool calls for the diff panel
3. Pass an `onToolCallClick` callback to `ToolCallGroup` that opens the rail and scrolls to the file
4. Manage the rail's expanded/collapsed state (can be lifted to `project-store` or kept local with `useState`)

**Recommended:** Keep the rail state local to `ChatView` with `useState` for now. Only lift to the store if we need it accessible from outside the chat (e.g., keyboard shortcuts from NavBar).

---

## Implementation Order

| Step | What | Files Changed |
|------|------|---------------|
| 1 | Add `extractDiffStats()` to `tool-summary.ts` | `tool-summary.ts` |
| 2 | Update `ToolCallData` to include `result` + `diffStats` | `ToolCallSection.tsx` |
| 3 | Update `ToolCallRow` to render diff stats with tabular-nums | `ToolCallSection.tsx` |
| 4 | Pass `result` through from ChatView → ToolCallGroup → ToolCallRow | `ChatView.tsx`, `ToolCallSection.tsx` |
| 5 | Add click handler on tool call rows | `ToolCallSection.tsx` |
| 6 | Create `ActivityRail` component (collapsed + expanded states) | NEW: `ActivityRail.tsx` |
| 7 | Create `SessionDiffView` component with diff accumulation | NEW: `SessionDiffView.tsx` |
| 8 | Update main process write handler to return `previousContent` | `ipc-handlers.ts` |
| 9 | Wire ActivityRail into ChatView layout | `ChatView.tsx` |
| 10 | Connect tool call clicks → open rail → scroll to file | `ChatView.tsx`, `SessionDiffView.tsx` |
| 11 | Polish animations, edge cases, keyboard accessibility | All new components |

---

## Key Components Summary

| Component | Location | Type | Change |
|-----------|----------|------|--------|
| `extractDiffStats` | `tool-summary.ts` | New function | Compute +N/-N from edit/write args |
| `ToolCallRow` | `ToolCallSection.tsx` | Updated | Show diff stats, add click handler |
| `ToolCallData` | `ToolCallSection.tsx` | Updated | Add `result`, `diffStats` fields |
| `ActivityRail` | `chat/ActivityRail.tsx` | New | Collapsible icon rail + expandable panel |
| `SessionDiffView` | `chat/SessionDiffView.tsx` | New | Multi-file diff viewer using @pierre/diffs CodeView |
| `ChatView` | `ChatView.tsx` | Updated | Add ActivityRail, pass result/click handlers |
| Write IPC handler | `ipc-handlers.ts` | Updated | Return previousContent in write result |

---

## Future Modes for the Activity Rail

The Activity Rail is designed to be extensible. Future modes could include:
- **File Tree Changes** — show only files modified in this session
- **Terminal Output** — inline terminal for bash/powershell tool results
- **Dependencies** — show package.json changes, lock file diff
- **Actions** — undo/redo file changes from this session

Each mode adds an icon to the collapsed rail and a content panel when expanded.

---

## Edge Cases

- **Multiple edits to same file:** Accumulate sequentially — apply edit 1, then edit 2 on the result of edit 1
- **Write after edit on same file:** Write replaces everything — the diff shows the accumulated state (edit then write = only write's result vs original)
- **Running tool calls:** Show no stats until `status === 'done'`
- **Empty edits:** `oldText === newText` → `+0 -0`, don't show stats
- **Very large diffs:** CodeView virtualizes, so performance should be fine. Cap at 50 files per response as safety.
- **No diffs in response:** The diff icon in the Activity Rail is still visible but greyed out / disabled
- **Panel resize:** Not in Phase 1. Fixed ~420px width with future resize grip.
