# Preload Hover Sessions with Desync Agent Creation

## Context

Currently, clicking a session in the sidebar triggers a full `reconnect()` call that does everything synchronously: open session file from disk, load extensions, create agent session, extract messages, return history. This makes session switching feel slow (~0.5-1s) because the agent must be fully spun up before any messages appear.

The goal is to **decouple message display from agent creation**:
1. Preload message history for all visible sidebar sessions (lightweight disk read)
2. On click, show preloaded messages instantly
3. Spin up the agent in the background (~0.5-1s)
4. Status bar shows "Connecting..." until agent is ready, then "Ready"

## Approach

### Backend: Lightweight History-Only Load

Add a new `loadHistoryFromDisk(sessionId, cwd)` method to `PiSessionManager` that reads the session file from disk and extracts messages **without** loading extensions or creating an agent session. This reuses the existing pattern found in `tryRefreshFromDisk()` (line 235-236 of session-manager.ts):

- `SdkSessionManager.open(match.path)` -> `.getEntries()` -> filter -> `extractHistoryFromSdkMessages()`

This is fast because it skips: `createResourceLoader()`, `loader.reload()`, `createAgentSession()`.

### Frontend: Preload on Sidebar Expand

When the TreeSidebar renders session items, trigger background prefetch of message history for all listed sessions. Store preloaded history in a `Map<sessionId, ChatMessageIPC[]>` in the project store.

### Frontend: Desync Click Flow

On session click:
1. Set `activeSessionId` immediately
2. If preloaded history exists, dispatch `SET_PRELOADED_HISTORY` so messages render instantly
3. Kick off full `reconnect()` in background (tracked via state)
4. Status bar shows "Connecting..." spinner
5. When reconnect completes, dispatch `AGENT_READY` so status bar switches to "Ready"
6. Subscribe to streaming events only after agent is ready

### Status Bar Enhancement

Extend `StatusIndicator` to show a three-state indicator:
- **No session selected**: hidden/neutral
- **Agent spinning up**: spinner + "Connecting..."
- **Agent ready**: "Ready" (current behavior)

## Files to Modify

### Backend
- `src/main/session-manager.ts` — Add `loadHistoryFromDisk(sessionId, cwd): Promise<ChatMessageIPC[]>`
- `src/main/ipc-handlers.ts` — Add handler for new `SESSION_LOAD_HISTORY_DISK` channel
- `src/shared/ipc-channels.ts` — Add `SESSION_LOAD_HISTORY_DISK` channel
- `src/shared/ipc-types.ts` — Add `SessionLoadHistoryDiskPayload` type
- `src/preload/index.ts` — Expose `loadHistoryFromDisk()` on session API

### Frontend
- `src/renderer/src/stores/project-store.tsx` — Add preloaded history map, new actions (`PRELOAD_HISTORY`, `SET_PRELOADED_HISTORY`, `AGENT_READY`, `CLEAR_PRELOADED_HISTORY`), `preloadAllSessions()` thunk, desync `reconnectSession()`
- `src/renderer/src/hooks/useSession.ts` — Handle preloaded history (skip loadHistory if preloaded), defer event subscription until agent ready
- `src/renderer/src/components/ChatView.tsx` — Pass agent-ready state to StatusIndicator
- `src/renderer/src/components/StatusIndicator.tsx` — Add "Connecting..." state with spinner
- `src/renderer/src/components/TreeSidebar.tsx` — Trigger `preloadAllSessions()` when session list is available

## Reuse

- `extractHistoryFromSdkMessages()` (session-manager.ts ~line 506) — Reused by new `loadHistoryFromDisk()` for message conversion
- `SdkSessionManager.open()` + `.getEntries()` pattern (session-manager.ts lines 235-236) — Reused for lightweight disk read
- `StreamBatcher` (stream-batcher.ts) — No change needed, still used in full reconnect
- `StatusIndicator` spinner animation (`SPINNER_FRAMES`) — Reused for "Connecting..." state
- `ChatMessageIPC` type — Shared format for both preloaded and live history

## Steps

- [ ] Add `SESSION_LOAD_HISTORY_DISK` to `ipc-channels.ts` and `SessionLoadHistoryDiskPayload` to `ipc-types.ts`
- [ ] Add `loadHistoryFromDisk(sessionId, cwd)` to `PiSessionManager` — lightweight disk-only read using `SdkSessionManager.open()` + `.getEntries()` + `extractHistoryFromSdkMessages()`
- [ ] Add IPC handler for `SESSION_LOAD_HISTORY_DISK` in `ipc-handlers.ts`
- [ ] Expose `loadHistoryFromDisk()` in `preload/index.ts` and update `NekoCodeIPC` type
- [ ] Add preload state to project-store: `preloadedHistory: Map<string, ChatMessageIPC[]>`, `agentReady: boolean`
- [ ] Add `PRELOAD_HISTORY`, `SET_PRELOADED_HISTORY`, `AGENT_READY`, `CLEAR_PRELOADED_HISTORY` actions to project-store
- [ ] Add `preloadAllSessions(projectPath, sessionIds)` async thunk that calls `loadHistoryFromDisk()` for each session
- [ ] Modify `reconnectSession()` in project-store to: (a) set activeSessionId + preloaded history immediately, (b) kick off full reconnect in background, (c) dispatch AGENT_READY when complete
- [ ] Modify `useSession.ts` to use preloaded history when available, defer event subscription until agent ready
- [ ] Add `isAgentConnecting` prop to `StatusIndicator`, show "Connecting..." spinner when true
- [ ] Trigger `preloadAllSessions()` from `TreeSidebar` when session list is available
- [ ] Handle edge case: user clicks a different session while agent is still spinning up for previous one (cancel/ignore stale reconnect)
- [ ] Handle edge case: session has no messages (empty session) — skip preload, show WelcomeScreen
- [ ] Handle edge case: preload fails (session file corrupt) — fall back to full reconnect on click

## Verification

1. Open a project with multiple existing sessions in the sidebar
2. Hover/expand sidebar — verify no blocking UI, preloads happen in background
3. Click a session — messages should appear instantly (no "Loading session messages..." flash)
4. Status bar should show "Connecting..." spinner immediately after click
5. After ~0.5-1s, status bar should switch to "Ready"
6. Send a prompt — should work normally (agent is ready)
7. Click a different session while first is still connecting — first reconnect should be discarded, new session's preloaded messages shown
8. Click a session that wasn't preloaded (e.g., just created) — should fall back to full reconnect with loading state
9. Run existing tests: `npm test` — all should pass
10. Manual: check main process logs for `loadHistoryFromDisk` calls and timing
