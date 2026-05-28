# Tool Call Diff Viewer

> **Status:** Planned | **Priority:** Medium | **Dependencies:** `@pierre/diffs` (already installed)

## Summary

Show inline diffs in the chat when the AI edits or writes files. Right now, edit and write tool calls display as a flat one-liner (e.g. `edit src/foo.ts`). This feature would expand those rows to show the actual code changes with syntax-highlighted diffs, using `@pierre/diffs` which is already integrated for the git DiffViewer.

## Current State

- `ToolCallGroup` renders each tool call as a single row with: status dot, tool name, one-line summary
- `extractToolSummary()` just shows the file path for edit/write (e.g. `src/foo.ts`)
- `AssistantToolCallMessage` has `args` (edit args include `{path, edits: [{oldText, newText}]}`, write args include `{path, content}`) and `result` (currently unused for diffs)
- No diff rendering anywhere in the chat — you can't see what the AI changed without opening the file

## What We Want

### Phase 1: Expandable Diff Rows

- Edit tool calls get a collapsible section that shows the diff between old and new content
- Use `processFile` from `@pierre/diffs` to generate diff data from the edit args directly (oldText vs newText per edit)
- Use `FileDiff` component from `@pierre/diffs/react` to render
- Click the row to expand/collapse

### Phase 2: Write Tool Calls

- For `write` calls, we need the *old* file content to show a diff (the new content is in `args.content`)
- Options:
  - a) Read the file from disk before write and include in the tool result (main process change)
  - b) Use git to get the previous version of the file
  - c) Show write as a "new file" with all lines as additions
- Best approach: (a) — the main process `write` handler should return `{ previousContent: string | null }` in its result, so the renderer can diff old vs new

### Phase 3: Multi-File CodeView

- When the AI makes multiple file edits in one response, show a `CodeView` (virtualized scrollable list) with all changed files
- Accept/reject buttons per file or per hunk using `@pierre/diffs` annotation system
- This is the big one — requires state management for pending changes

## Data Flow Changes Needed

### ToolCallData (ToolCallSection.tsx)

```ts
interface ToolCallData {
  id: string
  toolName: string
  status: 'running' | 'done'
  isError?: boolean
  args?: unknown
  result?: unknown  // already on the type, just not passed through
}
```

ChatView.tsx already has `result` on `AssistantToolCallMessage` but doesn't pass it to `ToolCallGroup`. Need to add it.

### Edit Args Shape

```ts
{
  path: string
  edits: Array<{ oldText: string; newText: string }>
}
```

Each edit entry is already a self-contained diff pair. Can use `processFile` or manually construct patches.

### Write Args Shape

```ts
{
  path: string
  content: string
}
```

Need `result.previousContent` to diff against. Requires main process change.

## Key Components

| Component | Location | Change |
|-----------|----------|--------|
| `ToolCallGroup` | `components/chat/ToolCallSection.tsx` | Pass `result` through, render expandable diff rows |
| `ToolCallRow` | same file | Add expand/collapse, render `FileDiff` when expanded |
| `extractToolSummary` | `components/chat/tool-summary.ts` | Maybe add diff stats (e.g. `+12 -3`) |
| `ChatView` | `components/chat/ChatView.tsx` | Pass `result` field when mapping `AssistantToolCallMessage` |
| Main process IPC handlers | `main/ipc-handlers.ts` | Return `previousContent` for write operations |

## @pierre/diffs API We'd Use

- `processFile(oldContent, newContent, options)` — generates structured diff data
- `FileDiff` from `@pierre/diffs/react` — renders a single file diff with syntax highlighting
- `CodeView` from `@pierre/diffs/react` — renders multiple files/diffs in a virtualized list (Phase 3)
- `DiffAcceptRejectHunkConfig` — accept/reject annotations on hunks (Phase 3)
- `disableWorkerPool` — same as git DiffViewer, skip workers for Electron compat

## Notes

- The `@pierre/diffs` package is already installed and working (used in git DiffViewer)
- Same `pierre-dark` theme + `disableWorkerPool` approach as DiffViewer.tsx
- Shadow DOM isolation means diff styles won't conflict with chat styles
- The `args` for edit already contain both old and new text — no IPC changes needed for Phase 1
