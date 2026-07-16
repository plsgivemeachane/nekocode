# NekoCode Abstraction & OOP Audit Report

> **Date:** 2025-06-15  
> **Scope:** Full `src/` directory (176 files, 39,243 lines)

---

## Project Size Summary

| Area | Files | Lines |
|------|-------|-------|
| Main process | 23 | 6,377 |
| Renderer | 79 | 11,364 |
| Shared | 2 | 634 |
| Preload | 1 | 221 |
| Tests | 71 | 20,647 |
| **Total** | **176** | **39,243** |

---

## Top Files by Line Count (Source Only)

| Lines | File |
|-------|------|
| 1,012 | `src/main/threading/worker-bootstrap.ts` |
| 737 | `src/main/session-manager.ts` |
| 640 | `src/main/git-operations-manager.ts` |
| 619 | `src/shared/ipc-types.ts` |
| 616 | `src/renderer/src/stores/project-store.tsx` |
| 615 | `src/renderer/src/hooks/useGitOperations.ts` |
| 551 | `src/main/ipc-handlers.ts` |
| 535 | `src/renderer/src/components/layout/TreeSidebar.tsx` |
| 504 | `src/main/electron-ui-context.ts` |
| 494 | `src/renderer/src/components/chat/ChatView.tsx` |
| 465 | `src/renderer/src/components/layout/RightSidebar.tsx` |
| 416 | `src/main/threading/threaded-session-manager.ts` |
| 395 | `src/renderer/src/components/chat/SearchPalette.tsx` |
| 348 | `src/renderer/src/hooks/useSession.ts` |

---

## Priority 1: Critical Duplication - handleAgentEvent (~200 lines x 2)

### The Problem

`handleAgentEvent()` is almost entirely duplicated between:

- `src/main/session-manager.ts` (line 472, ~200 lines)
- `src/main/threading/worker-bootstrap.ts` (line 117, ~200 lines)

Both contain **identical** logic for:

- `message_update` -> text_delta, thinking_start, thinking_delta, thinking_end
- `message_start` -> user message extraction, content parsing
- `message_end` -> assistant finalization, usage tracking
- `tool_execution_start` -> tool call tracking, message association
- `tool_execution_end` -> tool result tracking
- `agent_start` / `agent_end` / `turn_start` / `turn_end` handling
- `finalizeThinkingMessage()` and `finalizeAssistantMessage()` helpers

The **only** differences are:

1. Session-manager uses `StreamBatcher` for batching; worker-bootstrap does not
2. Session-manager captures `previousFileContent` for diff support in `tool_execution_start/end`
3. Worker-bootstrap emits via `parentPort.postMessage()` instead of `this.onEvent()`

### The Fix: Extract a Shared AgentEventProcessor Class

```typescript
// src/main/agent-event-processor.ts

export interface AgentEventEmitter {
  emit(sessionId: string, event: SessionStreamEvent): void
}

export interface ManagedSessionState {
  messages: ChatMessageIPC[]
  currentAssistantId: string | null
  currentAssistantContent: string
  currentThinkingId: string | null
  currentThinkingContent: string
  currentToolCallId: string | null
  usageTotals: { input: number; output: number; totalCost: number }
  previousFileContent: Map<string, string>
  session: AgentSession
}

export class AgentEventProcessor {
  constructor(
    private emitter: AgentEventEmitter,
    private options?: { capturePreviousContent?: boolean }
  ) {}

  handleEvent(sessionId: string, event: AgentSessionEvent, managed: ManagedSessionState): void {
    // Single implementation of the switch statement
  }

  finalizeAssistantMessage(managed: ManagedSessionState): void { ... }
  finalizeThinkingMessage(managed: ManagedSessionState): void { ... }
}
```

**Main-thread usage:**

```typescript
const processor = new AgentEventProcessor(
  { emit: (id, ev) => this.onEvent(id, ev) },
  { capturePreviousContent: true }
)
```

**Worker-thread usage:**

```typescript
const processor = new AgentEventProcessor(
  { emit: (id, ev) => parentPort?.postMessage({ type: 'session_event', sessionId: id, event: ev }) },
  { capturePreviousContent: false }
)
```

**Estimated savings: ~180 lines (eliminating the duplicate).**

---

## Priority 2: Duplicated ManagedSession Interface

### The Problem

`ManagedSession` is defined separately in both files with nearly identical fields:

**session-manager.ts:**

```typescript
interface ManagedSession {
  session: AgentSession
  unsubscribe: () => void
  batcher: StreamBatcher           // <- main-thread only
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
  messages: ChatMessageIPC[]
  currentAssistantId: string | null
  currentAssistantContent: string
  currentThinkingId: string | null
  currentThinkingContent: string
  hasPrompted: boolean             // <- main-thread only
  usageTotals: { input: number; output: number; totalCost: number }
  currentToolCallId: string | null
  previousFileContent: Map<string, string>  // <- main-thread only
  uiContext: ElectronUIContext
}
```

**worker-bootstrap.ts:**

```typescript
interface ManagedSession {
  session: AgentSession
  unsubscribe: () => void
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
  messages: ChatMessageIPC[]
  currentAssistantId: string | null
  currentAssistantContent: string
  currentThinkingId: string | null
  currentThinkingContent: string
  currentToolCallId: string | null
  usageTotals: { input: number; output: number; totalCost: number }
  uiContext: ElectronUIContext
}
```

### The Fix: Shared Base Interface with Extension

```typescript
// src/main/managed-session.ts (new file)

export interface ManagedSessionBase {
  session: AgentSession
  unsubscribe: () => void
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
  messages: ChatMessageIPC[]
  currentAssistantId: string | null
  currentAssistantContent: string
  currentThinkingId: string | null
  currentThinkingContent: string
  currentToolCallId: string | null
  usageTotals: { input: number; output: number; totalCost: number }
  uiContext: ElectronUIContext
}

// Extended by main-thread session-manager
export interface MainManagedSession extends ManagedSessionBase {
  batcher: StreamBatcher
  hasPrompted: boolean
  previousFileContent: Map<string, string>
}
```

**Estimated savings: ~30 lines.**

---

## Priority 3: IPC Layer - Repetitive Handler Registration

### The Problem

`ipc-handlers.ts` (551 lines) has a repeating pattern for each IPC channel:

```typescript
ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, payload: SessionCreatePayload): Promise<SessionCreateResult> => {
  validateIpcSender(_event)
  logger.info(`SESSION_CREATE cwd=${payload.cwd}`)
  try {
    // ... actual logic
  } catch (err) {
    logger.error('SESSION_CREATE failed', err)
    throw err
  }
})
```

This pattern repeats ~25+ times with the same validate/log/try-catch wrapper.

Similarly, `preload/index.ts` (260 lines) repeats:

```typescript
methodName: (args): Promise<ReturnType> =>
  ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_NAME, { args })
```

### The Fix: Type-Safe IPC Router

```typescript
// src/main/ipc-router.ts (new file)

type IpcHandler<TInput, TOutput> = (input: TInput) => Promise<TOutput>

export function registerHandler<TInput, TOutput>(
  channel: string,
  handler: IpcHandler<TInput, TOutput>,
  options?: { logPayload?: boolean }
): void {
  ipcMain.handle(channel, async (_event, payload: TInput): Promise<TOutput> => {
    validateIpcSender(_event)
    if (options?.logPayload) logger.info(`${channel}`, payload)
    try {
      return await handler(payload)
    } catch (err) {
      logger.error(`${channel} failed`, err)
      throw err
    }
  })
}
```

Usage becomes:

```typescript
registerHandler<SessionCreatePayload, SessionCreateResult>(
  IPC_CHANNELS.SESSION_CREATE,
  (payload) => sessionManager.create(payload.cwd).then(id => ({ sessionId: id, ... }))
)
```

**Estimated savings: ~100 lines from ipc-handlers.ts.**

---

## Priority 4: Renderer - Extract Message Grouping Logic from ChatView

### The Problem

`ChatView.tsx` (494 lines) contains ~60 lines of inline message grouping logic (the `while` loop building `MessageGroup[]`) that is complex, hard to test, and should be a pure function.

### The Fix: Extract to a Pure Function + Custom Hook

```typescript
// src/renderer/src/utils/message-grouper.ts

export type MessageGroup =
  | { key: string; type: 'single'; msg: ChatMessage }
  | { key: string; type: 'tool-group'; msgs: ToolCallMsg[] }
  | { key: string; type: 'thinking-group'; msgs: ThinkingMsg[] }
  | { key: string; type: 'ui-dialog' }
  | { key: string; type: 'workflow-step'; workflowId: string }

export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  // Pure function - easily testable
}
```

Then in `ChatView.tsx`:

```typescript
const messageGroups = useMemo(() => groupMessages(messages), [messages])
```

**Estimated savings: ~50 lines from ChatView + testability.**

---

## Priority 5: Renderer - Split project-store.tsx (616 lines)

### The Problem

`project-store.tsx` is a monolithic store handling:

- Project CRUD
- Session management state (statuses, streaming)
- Active session tracking
- Sidebar/panel state
- Model selection
- Theme/dark mode
- Zoom level
- Extension errors
- Workflow tracking

This violates the Single Responsibility Principle. A change to sidebar state causes all consumers to re-render.

### The Fix: Split into Focused Stores

```typescript
// stores/session-store.ts      - session statuses, streaming, active session
// stores/project-store.ts      - project CRUD, workspace
// stores/ui-store.ts           - sidebar, panels, theme, zoom
// stores/workflow-store.ts     - workflow tracking
```

Use Zustand slice pattern or independent stores with selectors to prevent cross-cutting re-renders.

**Estimated savings: ~50 lines from reduced boilerplate + better re-render performance.**

---

## Priority 6: Extract useGitOperations Hook Logic (615 lines)

### The Problem

`useGitOperations.ts` is 615 lines and mixes:

- IPC call orchestration
- Polling/refetch logic
- State management (loading, error, data)
- Visibility-based pause/resume
- Debounce/backoff logic

The polling/backoff/debounce patterns are generic and reusable.

### The Fix: Extract Generic Polling Hook + Git API Layer

```typescript
// hooks/usePolling.ts
export function usePolling<T>(
  fetcher: () => Promise<T>,
  options: { interval: number; enabled: boolean; backoff?: ... }
): { data: T; isLoading: boolean; error: Error | null; refresh: () => void }

// hooks/useGitApi.ts - thin IPC wrapper (no state, just async functions)
export const gitApi = {
  getStatus: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, { cwd }),
  getLog: (cwd: string, count: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, { cwd, count }),
  // ...
}

// hooks/useGitOperations.ts - becomes a slim composition
export function useGitOperations(cwd: string | null) {
  const status = usePolling(() => gitApi.getStatus(cwd!), { interval: 5000, enabled: !!cwd })
  const log = usePolling(() => gitApi.getLog(cwd!, 50), { interval: 10000, enabled: !!cwd })
  // ...
}
```

**Estimated savings: ~200 lines.**

---

## Priority 7: Abstract the Worker Thread Communication Protocol

### The Problem

`threaded-session-manager.ts` (416 lines) and `threaded-project-manager.ts` (115 lines) both implement the same worker communication pattern:

1. Send command message to worker
2. Await response message with matching `commandId`
3. Handle worker crash/restart
4. Forward events from worker to renderer

This is the Command pattern duplicated across two files.

### The Fix: Generic Worker Bridge

```typescript
// src/main/threading/worker-bridge.ts

export class WorkerBridge<TCommands extends Record<string, any>> {
  constructor(private worker: Worker, private commandMap: TCommands) {}

  async sendCommand<K extends keyof TCommands>(
    command: K,
    payload: Parameters<TCommands[K]>[0]
  ): Promise<ReturnType<TCommands[K]>> {
    // Unified command/response correlation
  }

  onEvent(handler: (event: WorkerEventMessage) => void): () => void {
    // Unified event forwarding
  }

  onCrash(handler: () => void): void {
    // Unified crash recovery
  }
}
```

Then:

```typescript
// threaded-session-manager.ts becomes:
const bridge = new WorkerBridge(sessionWorker, {
  create: (cwd: string) => string,
  prompt: (payload: { sessionId: string; text: string }) => void,
  // ...
})
```

**Estimated savings: ~150 lines from threaded managers.**

---

## Priority 8: Shared TextContent Extraction

### The Problem

The pattern of extracting text from multi-format message content appears in 3 places:

- `session-manager.ts` handleAgentEvent -> message_start
- `worker-bootstrap.ts` handleAgentEvent -> message_start
- `text-extractor.ts` -> extractTextContent

Both `handleAgentEvent` implementations inline this extraction instead of using the existing shared utility.

### The Fix

`text-extractor.ts` already exists with `extractTextContent()` and `extractThinkingContent()`. Both `handleAgentEvent` implementations should use these instead of inline extraction. This is a small but symbolic fix - it establishes the pattern of "shared utility over inline logic."

**Estimated savings: ~20 lines + consistency.**

---

## Priority 9: Large Component Files - Extract Sub-components

Several renderer components exceed reasonable sizes and mix concerns:

| Component | Lines | Suggestion |
|-----------|-------|------------|
| `TreeSidebar.tsx` | 535 | Extract `FileTree`, `FileTreeItem`, `FileContextMenu` as separate components |
| `ChatView.tsx` | 494 | Extract `EmptyState`, `MessageTimeline`, `MessageRenderer` (Priority 4 helps) |
| `RightSidebar.tsx` | 465 | Extract `DiffPanel`, `OutlinePanel` (already partially done), `DragResizeHandle` |
| `SearchPalette.tsx` | 395 | Extract `SearchInput`, `SearchResultList`, `SearchProvider` |
| `GitCommandCenter.tsx` | 353 | Extract `GitActionButton`, `GitCommandHistory` |
| `ChatInput.tsx` | 303 | Extract `FileAttachmentArea`, `SlashCommandAutocomplete` |

This is about organization and testability rather than line reduction.

---

## Priority 10: ipc-types.ts (619 lines) - Split by Domain

### The Problem

A single 619-line type file forces every module that needs even one type to import the entire namespace.

### The Fix: Domain-Specific Type Files

```
src/shared/types/
  session.ts      - SessionCreatePayload, SessionStreamEvent, ChatMessageIPC, etc.
  project.ts      - ProjectInfo, WorkspacePayload, etc.
  git.ts          - GitStatus, GitLogEntry, etc.
  ui.ts           - UIRequest, UIResponse, etc.
  update.ts       - UpdateAvailableInfo, UpdateProgress, etc.
  index.ts        - Re-exports everything for backward compatibility
```

This is about organization and import hygiene rather than line reduction.

---

## Summary of Estimated Savings

| Priority | What | Est. Lines Saved | Impact |
|----------|------|-----------------|--------|
| 1 | Extract `AgentEventProcessor` | ~180 | Eliminates critical duplication bug surface |
| 2 | Shared `ManagedSession` interface | ~30 | Single source of truth for session state |
| 3 | Type-safe IPC router | ~100 | Reduces boilerplate, enforces consistent error handling |
| 4 | Extract message grouping | ~50 | Testability, separation of concerns |
| 5 | Split project-store | ~50 | Re-render perf, SRP compliance |
| 6 | Extract polling hook from useGitOperations | ~200 | Reusable hook, reduced hook complexity |
| 7 | Generic WorkerBridge | ~150 | Eliminates Command pattern duplication |
| 8 | Use shared text-extractor | ~20 | Consistency, DRY |
| 9 | Extract sub-components | ~0 | Organization, testability |
| 10 | Split ipc-types | ~0 | Import hygiene, organization |
| | **Total estimated reduction** | **~780 lines** | |

---

## Recommended Implementation Order

1. **Priority 1 + 2** (together) - Extract `AgentEventProcessor` + shared `ManagedSession` interface. These are intertwined and should be done as one PR.
2. **Priority 8** - Quick win, use existing `text-extractor.ts` in both `handleAgentEvent` implementations.
3. **Priority 3** - IPC router. Independent of other changes, high impact on boilerplate.
4. **Priority 7** - WorkerBridge. Independent of other changes, reduces threading duplication.
5. **Priority 6** - Extract `usePolling` hook. Independent, high line savings.
6. **Priority 4 + 5** - Renderer refactoring (message grouper + store split). Can be done in parallel.
7. **Priority 9 + 10** - Low priority organization improvements.

> **Note:** The most impactful single change is **Priority 1** (extracting `AgentEventProcessor`). It eliminates the most critical duplication, reduces the bug surface (currently a fix in one copy must be manually replicated to the other), and establishes the OOP pattern for the rest of the main process.
