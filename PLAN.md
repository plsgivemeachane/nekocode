# Streaming "Agent Working" Indicator Improvements

## Context

The SDK already emits clear lifecycle events (`agent_start`, `agent_end`, `turn_start`, `turn_end`, `tool_execution_start`, etc.), but `session-manager.ts` explicitly **ignores** `agent_start` (falls into `default` case — comment: "not useful for the renderer"). As a result, the renderer has no reliable signal for when the agent starts working. The current workarounds are:

1. **Sidebar status** (`project-store.tsx`): Uses a **2-second debounce hack** on `text_delta` — sets status to `'streaming'` on first delta, then resets to `'idle'` after 2s of silence. This means there's always a ~2s window where the status flickers to idle mid-turn, and there's zero indication between prompt send and first token.
2. **Chat `isStreaming`** (`useSession.ts`): Only set `true` on `text_delta`, so there's a gap between user sending the prompt and the first token arriving.
3. **No working indicator** below the agent's current message during tool execution or thinking.
4. **Auto-scroll** exists but doesn't account for tool_call messages properly.

The fix: forward `agent_start` as a real IPC event, consume it everywhere, and **kill the debounce hack**.

## Approach

### Phase 1: Wire `agent_start` through the pipeline

Add a new `agent_start` event type to `SessionStreamEvent`, forward it from `session-manager.ts` when the SDK emits `agent_start`, and consume it in both `useSession.ts` (for `isStreaming`) and `project-store.tsx` (for sidebar status).

### Phase 2: UI indicators

1. **Sidebar dot** — already works via `StatusDot` + `sessionStatuses`, just needs the correct signal (Phase 1 fixes this)
2. **In-message working indicator** — add a persistent working indicator (e.g., pulsing dots, or a subtle "Agent is working..." text) below the last message/content. This is shown for the **entire duration** the agent is working — from `agent_start` until `agent_end`. It stays visible during text streaming, during tool execution, and during thinking gaps. It only disappears when the agent fully finishes.
3. **Send button lock** — already implemented (`disabled={isStreaming}`), just needs the earlier `isStreaming=true` from Phase 1
4. **Auto-scroll** — already implemented with `isAtBottomRef` sticky logic, works correctly

## Files to Modify

| File | Change |
|------|--------|
| `src/shared/ipc-types.ts` | Add `{ type: 'agent_start' }` to `SessionStreamEvent` union |
| `src/main/session-manager.ts` | Forward `agent_start` from SDK as `{ type: 'agent_start' }` via batcher (remove from `default` case) |
| `src/renderer/src/hooks/useSession.ts` | Handle `agent_start` → set `isStreaming = true` |
| `src/renderer/src/stores/project-store.tsx` | Handle `agent_start` → set status `'streaming'`. **Remove the 2-second debounce hack entirely**. |
| `src/renderer/src/components/ChatView.tsx` | Add a working spinner below the last message when `isStreaming &&` no active text streaming |

## Reuse

- **`StatusDot`** in `TreeSidebar.tsx` (line 16) — already renders `bg-accent-400 animate-glow-pulse` for `'streaming'` status. No changes needed to sidebar UI.
- **`isAtBottomRef` + `scrollToBottom`** in `ChatView.tsx` (lines 28-55) — auto-scroll sticky logic already works correctly. No changes needed.
- **Send button `disabled={isStreaming}`** in `ChatView.tsx` (line 261) — already wired. Will automatically work once `isStreaming` goes true earlier.

## Steps

- [ ] **Step 1**: Add `{ type: 'agent_start' }` to `SessionStreamEvent` union in `src/shared/ipc-types.ts`
- [ ] **Step 2**: In `src/main/session-manager.ts`, move `agent_start` out of the `default` case. Call `emit({ type: 'agent_start' })` (flush batcher first so any prior content arrives before the start signal)
- [ ] **Step 3**: In `src/renderer/src/hooks/useSession.ts`, add `case 'agent_start': setIsStreaming(true); break;` in the event switch
- [ ] **Step 4**: In `src/renderer/src/stores/project-store.tsx`, add `case 'agent_start': dispatch UPDATE_SESSION_STATUS → 'streaming'; break;`. **Remove the entire debounce mechanism** (`debounceRef`, the `setTimeout` in `text_delta`, and the cleanup in `done`/`error`). Simplify `text_delta` to a no-op for status (or remove the case entirely since `useSession` handles it).
- [ ] **Step 5**: In `src/renderer/src/components/ChatView.tsx`, add a persistent working indicator after the last message group when `isStreaming` is true. This indicator stays visible for the **entire** agent execution (from `agent_start` through all turns until `agent_end`). Use a subtle design — e.g., three pulsing dots or a dimmed "Agent is working..." line — that doesn't distract from streaming text but clearly signals the agent is active. It renders below the message stream area, always at the bottom of the content.

## Verification

1. Send a prompt → sidebar dot should light up **immediately** (before first token), send button should disable immediately
2. During tool execution → sidebar dot stays lit, working indicator visible below the tool call group
3. After `agent_end` → sidebar dot goes idle, send button re-enables, working indicator disappears
4. No 2-second flicker to idle mid-turn (debounce is gone)
5. Auto-scroll: scroll to bottom → sticks during streaming. Scroll up → unsticks. Scroll-to-bottom button appears when scrolled up.
