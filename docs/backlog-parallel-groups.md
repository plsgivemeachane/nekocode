# Backlog Task Parallel Grouping

> Generated: 2026-05-17 | Purpose: Group remaining backlog items into parallel-safe work streams with minimal file conflict.

---

## Items Excluded (Already Done)

- [x] ~~Complete sound system!~~ (COMPLETED)
- [x] ~~Workflows and pi command~~ (COMPLETED)
- [x] ~~Change blackish~~ (complete)
- [x] ~~Need message box bigger~~ (FIXED)

---

## Remaining Active Items (11 tasks)

| # | Task | Primary Touchpoints |
|---|------|--------------------|
| A | **GitHub Worktree** | `project-manager.ts`, `ipc-handlers.ts`, `ipc-channels.ts`, `ipc-types.ts`, `preload/index.ts`, `TreeSidebar.tsx` (new worktree section) |
| B | **Edit Windows (Edit diff PER TURN)** | New renderer component(s) + `ChatView.tsx` (diff view rendering), `message-transforms.ts`, `chat.ts` types, possibly `AssistantMessage.tsx` |
| C | **GitHub Interaction (Commit & git integration)** | New `git-manager.ts` in main, `ipc-handlers.ts`, `ipc-channels.ts`, `ipc-types.ts`, `preload/index.ts`, new UI in `TreeSidebar.tsx` or new panel |
| D | **File Structure Viewer** | New renderer component, `ipc-handlers.ts`, `ipc-channels.ts`, `ipc-types.ts`, `preload/index.ts`, `project-manager.ts` or new `file-service.ts` |
| E | **File Tree** | `TreeSidebar.tsx` (major extension), `project-store.tsx`, `ipc-handlers.ts`, `preload/index.ts` |
| F | **Polish UI (remaining items)** | Global: `App.tsx`, `ChatView.tsx`, `TreeSidebar.tsx`, `ChatInput.tsx`, CSS/Tailwind across many components |
| G | **Pi File Sending** | `session-manager.ts`, `ipc-handlers.ts`, `ipc-types.ts`, `ChatView.tsx`, `ToolCallSection.tsx` or new component |
| H | **Add Action (command that runs by a click)** | `GlobalCommandPalette.tsx`, `useCommands.ts`, `ChatView.tsx`, `ipc-handlers.ts`, new action-button component |
| I | **Open in VSCode** | `ipc-handlers.ts`, `ipc-channels.ts`, `preload/index.ts`, `index.ts` (main), `ContextMenu.tsx` or `TreeSidebar.tsx` |
| J | **Open side (bottom) terminal** | `App.tsx` (layout restructure), new `TerminalPanel.tsx`, `index.ts` (main - node-pty), `preload/index.ts`, `ipc-handlers.ts` |
| K | **Todo List Parser** | New renderer component, `ChatView.tsx` or `AssistantMessage.tsx`, `MarkdownContent.tsx` |

---

## Parallel Groups

### GROUP 1 — "IPC Foundation Layer" (Do FIRST, enables others)

These all need new IPC channels, preload exposure, and main-process handlers.
They conflict HEAVILY with each other on shared files, so they must be **sequenced** within this group.

| Task | Shared Conflict Files | Notes |
|------|----------------------|-------|
| I. Open in VSCode | `ipc-channels.ts`, `ipc-types.ts`, `ipc-handlers.ts`, `preload/index.ts` | Smallest scope, quick win |
| C. GitHub Interaction | Same 4 files + new `git-manager.ts` | git commit/push IPC foundation |
| A. GitHub Worktree | Same 4 files + `project-manager.ts` | Extends the git IPC foundation |
| D. File Structure Viewer | Same 4 files + new `file-service.ts` | file-read IPC |

**Recommended order:** I -> C -> A -> D (smallest/simplest first)

- [ ] I. Open in VSCode
- [ ] C. GitHub Interaction (commit & git integration)
- [ ] A. GitHub Worktree
- [ ] D. File Structure Viewer

---

### GROUP 2 — "Renderer-Only Features" (Fully Parallel)

These live almost entirely in the renderer layer with **zero shared files** between them.
All 3 can be developed simultaneously with no merge conflicts.

| Task | Touches | Conflict Risk |
|-------|---------|---------------|
| K. Todo List Parser | New `TodoListParser.tsx`, `MarkdownContent.tsx`, `AssistantMessage.tsx` | None with B, H |
| B. Edit Diff Per Turn | New `DiffView.tsx`, `ChatView.tsx` (diff branch), `chat.ts` types, `message-transforms.ts` | None with K, H |
| H. Add Action Button | `GlobalCommandPalette.tsx`, `useCommands.ts`, new `ActionButton.tsx` | None with K, B |

- [ ] K. Todo List Parser
- [ ] B. Edit Windows (Edit diff PER TURN)
- [ ] H. Add Action (command that runs by a click)

---

### GROUP 3 — "Layout & Shell" (Sequential, conflicts on App.tsx)

These both restructure the main app layout and share `App.tsx`.
Must be done sequentially.

| Task | Touches | Overlap |
|-------|---------|--------|
| E. File Tree | `TreeSidebar.tsx` (major rewrite), `App.tsx` (sidebar width), `project-store.tsx` | Shares `App.tsx` layout with J |
| J. Bottom Terminal | `App.tsx` (layout split), new `TerminalPanel.tsx`, `index.ts` (node-pty), `preload/index.ts` | Shares `App.tsx` layout with E |

**Recommended order:** E first (TreeSidebar more self-contained), then J (terminal reshapes entire flex layout).

- [ ] E. File Tree
- [ ] J. Open side (bottom) terminal

---

### GROUP 4 — "Cross-Cutting" (Depends on Groups 1 & 2)

These span both IPC and renderer layers and depend on earlier work.

| Task | Depends On | Touches |
|-------|-----------|--------|
| G. Pi File Sending | Group 1 IPC + Group 2 B (message rendering) | `session-manager.ts`, `ipc-handlers.ts`, `ChatView.tsx`, `ToolCallSection.tsx` |
| F. Polish UI | Everything above should be stable first | Global CSS/Tailwind, `App.tsx`, `ChatView.tsx`, `TreeSidebar.tsx`, `ChatInput.tsx` |

- [ ] G. Pi File Sending
- [ ] F. Polish UI (dead last — touches everything)

---

## Execution Timeline

```
PHASE 1 (Sequential — shared IPC files):
  1a. [ ] Open in VSCode (I)        <- smallest, quick win
  1b. [ ] GitHub Interaction (C)    <- git commit/push IPC
  1c. [ ] GitHub Worktree (A)       <- extends git IPC
  1d. [ ] File Structure Viewer (D) <- file-read IPC

PHASE 2 (Fully Parallel — disjoint renderer):
  || 2a. [ ] Todo List Parser (K)
  || 2b. [ ] Edit Diff Per Turn (B)
  || 2c. [ ] Add Action Button (H)

PHASE 3 (Sequential — layout restructuring):
  3a. [ ] File Tree (E)
  3b. [ ] Bottom Terminal (J)

PHASE 4 (Cross-cutting — depends on above):
  4a. [ ] Pi File Sending (G)
  4b. [ ] Polish UI (F)             <- dead last, touches everything
```

---

## Key Insight

The bottleneck is the shared IPC layer (`ipc-channels.ts`, `ipc-types.ts`, `ipc-handlers.ts`, `preload/index.ts`) — 6 of the 11 tasks all need to modify these same 4 files. The fastest path is to batch all IPC additions in Phase 1, then the 3 renderer-only features in Phase 2 can run in true parallel with zero merge conflicts.
