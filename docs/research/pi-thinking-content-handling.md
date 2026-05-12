# Pi Agent Thinking Content Handling — Research Report

**Date:** 2026-05-12
**Researcher:** AI Assistant (NekoCode pi agent)
**Status:** Complete

---

## Executive Summary

NekoCode currently **ignores all thinking/reasoning content** emitted by the Pi coding agent during streaming. Pi's `AssistantMessageEvent` protocol includes three thinking-specific event types (`thinking_start`, `thinking_delta`, `thinking_end`) that are silently dropped by both `session-manager.ts` and `worker-bootstrap.ts`. Additionally, Pi stores thinking content in `ThinkingContent` blocks that interleave with text and tool calls inside `AssistantMessage.content` arrays — none of which is surfaced to NekoCode's renderer.

---

## Pi SDK Thinking Infrastructure

### Thinking Level Enum

Pi supports 6 thinking levels on models that have reasoning capabilities:

```typescript
// From: @earendil-works/pi-ai/dist/types.d.ts
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
export type ModelThinkingLevel = "off" | ThinkingLevel;
```

### Thinking Budgets

Token-based providers can configure per-level thinking token budgets:

```typescript
// From: @earendil-works/pi-ai/dist/types.d.ts
export interface ThinkingBudgets {
    minimal?: number;
    low?: number;
    medium?: number;
    high?: number;
}
```

### Thinking Content Block

Thinking is stored as content blocks inside `AssistantMessage.content` arrays, interleaved with text and tool calls:

```typescript
// From: @earendil-works/pi-ai/dist/types.d.ts (line 103-109)
export interface ThinkingContent {
    type: "thinking";
    thinking: string;
    thinkingSignature?: string;
    /** When true, the thinking content was redacted by safety filters.
     *  The opaque encrypted payload is stored in `thinkingSignature` so it
     *  can be passed back to the API for multi-turn continuity. */
    redacted?: boolean;
}
```

### AssistantMessage Content Array

```typescript
// From: @earendil-works/pi-ai/dist/types.d.ts (line 146)
export interface AssistantMessage {
    role: "assistant";
    content: (TextContent | ThinkingContent | ToolCall)[];
    // ...
}
```

---

## Stream Event Protocol

### Pi's `AssistantMessageEvent` Union (Full)

```typescript
// From: @earendil-works/pi-ai/dist/types.d.ts (lines 187-235)
export type AssistantMessageEvent =
    | { type: "start"; partial: AssistantMessage }
    | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
    | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
    | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
    | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
    | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
    | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
    | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
    | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
    | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
    | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
    | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };
```

The three thinking-specific events are highlighted above.

### Pi's `AgentEvent` Type

```typescript
// From: @earendil-works/pi-agent-core/dist/types.d.ts (line 330-360)
export type AgentEvent =
    | { type: "agent_start" }
    | { type: "agent_end"; messages: AgentMessage[] }
    | { type: "turn_start" }
    | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
    | { type: "message_start"; message: AgentMessage }
    | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
    | { type: "message_end"; message: AgentMessage }
    | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
    | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
    | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

The `message_update` event wraps an `AssistantMessageEvent`, which contains the thinking deltas. This is the single streaming event type that carries ALL text, thinking, and tool call content updates.

### Pi's `AgentSessionEvent` (Session-specific Extensions)

```typescript
// From: @earendil-works/pi-coding-agent/dist/core/agent-session.d.ts (line 41-70)
export type AgentSessionEvent = AgentEvent
    | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
    | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
    | { type: "session_info_changed"; name: string | undefined }
    | { type: "thinking_level_changed"; level: ThinkingLevel }
    | { type: "compaction_end"; ... }
    | { type: "auto_retry_start"; ... }
    | { type: "auto_retry_end"; ... };
```

Note: The `thinking_level_changed` event is emitted when the user changes thinking level (e.g., via `/thinking` command).

---

## Pi's Thinking-Related Methods on AgentSession

```typescript
// From: @earendil-works/pi-coding-agent/dist/core/agent-session.d.ts
class AgentSession {
    get thinkingLevel(): ThinkingLevel;              // Current thinking level
    supportsThinking(): boolean;                     // Does current model support thinking?
    setThinkingLevel(level: ThinkingLevel): void;     // Set thinking level
    cycleThinkingLevel(): ThinkingLevel | undefined;  // Cycle to next level
    getAvailableThinkingLevels(): ThinkingLevel[];    // Levels for current model
}
```

---

## Provider-Level Thinking Configuration

Pi supports multiple thinking formats across providers:

```typescript
// From: @earendil-works/pi-ai/dist/types.d.ts (line 265)
thinkingFormat?: "openai" | "openrouter" | "deepseek" | "zai" | "qwen" | "qwen-chat-template";
```

Compat options:
- `requiresThinkingAsText?: boolean` — Whether thinking blocks must be converted to text blocks with `<thinking>` delimiters
- `requiresReasoningContentOnAssistantMessages?: boolean` — Whether replayed assistant messages must include empty `reasoning_content`
- `supportsReasoningEffort?: boolean` — Whether the provider supports `reasoning_effort` parameter

---

## NekoCode's Current State — What Is Ignored

### 1. Event Handling Gap

Both `src/main/session-manager.ts` and `src/main/threading/worker-bootstrap.ts` have identical `handleAgentEvent` functions that only process `text_delta` from `message_update` events:

```typescript
// Current code in BOTH files
case 'message_update': {
    const sub = event.assistantMessageEvent
    if (sub.type === 'text_delta') {
        if (!managed.currentAssistantId) {
            managed.currentAssistantId = crypto.randomUUID()
            managed.currentAssistantContent = ''
        }
        managed.currentAssistantContent += sub.delta
        emitEvent(sessionId, { type: 'text_delta', delta: sub.delta })
    }
    // ⚠️ thinking_start, thinking_delta, thinking_end are SILENTLY DROPPED
    break
}
```

### 2. Type Gap

`src/shared/ipc-types.ts` — `SessionStreamEvent` has NO thinking types:

```typescript
export type SessionStreamEvent =
    | { type: 'agent_start' }
    | { type: 'text_delta'; delta: string }
    | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown }
    | { type: 'tool_result'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
    | { type: 'usage_update'; usage: UsageData }
    | { type: 'error'; message: string }
    | { type: 'done' }
    | { type: 'user_message'; text: string }
    // ⚠️ Missing: thinking_delta, thinking_start, thinking_end
```

### 3. Batcher Gap

`src/main/stream-batcher.ts` — `StreamBatcher` only batches `text_delta` events:

```typescript
push(event: SessionStreamEvent): void {
    if (event.type === 'text_delta') {
        this.pendingText += event.delta
        // ...
    } else {
        // Non-text events flush pending text first, then pass through
        this.flush()
        this.onFlush(event)
    }
}
// ⚠️ No thinking event batching
```

### 4. UI Type Gap

`src/renderer/src/types/chat.ts` — `ChatMessage` has no thinking message type:

```typescript
export type ChatMessage =
    | { role: 'user'; content: string; id: string }
    | { role: 'assistant'; type: 'text'; content: string; id: string; usage?: MessageUsage }
    | { role: 'assistant'; type: 'tool_call'; toolName: string; ... }
    // ⚠️ Missing: { role: 'assistant'; type: 'thinking'; content: string; ... }
```

---

## Research Methodology

### Sources Searched

| Source | Status | Findings |
|---|---|---|
| Pi SDK `.d.ts` files (`@earendil-works/pi-ai`) | ✅ Fully read | Found `AssistantMessageEvent`, `ThinkingContent`, `ThinkingLevel`, `ThinkingBudgets` |
| Pi SDK `.d.ts` files (`@earendil-works/pi-agent-core`) | ✅ Fully read | Found `AgentEvent`, `ThinkingLevel` re-export |
| Pi SDK `.d.ts` files (`@earendil-works/pi-coding-agent`) | ✅ Fully read | Found `AgentSessionEvent`, `thinking_level_changed`, thinking methods |
| NekoCode `session-manager.ts` | ✅ Fully read | Confirmed only `text_delta` handled |
| NekoCode `worker-bootstrap.ts` | ✅ Fully read | Confirmed only `text_delta` handled |
| NekoCode `stream-batcher.ts` | ✅ Fully read | Confirmed only `text_delta` batched |
| NekoCode `ipc-types.ts` | ✅ Fully read | Confirmed no thinking event types |
| NekoCode `chat.ts` | ✅ Fully read | Confirmed no thinking message type |
| Firecrawl web search | ⚠️ Attempted (3×) | No results returned; but SDK source provided complete information |
| Pi `pi_docs` / `pi_changelog` | ❌ Not available | "Could not locate Pi installation" |

### Conclusion on Firecrawl Search

Three separate Firecrawl search attempts targeting "pi coding agent thinking reasoning content" returned no usable results. However, the **Pi SDK source `.d.ts` files provided complete information** about all thinking-related types, events, and methods, making the web search non-essential for this research.

---

## Implementation Requirements

To surface thinking content in NekoCode, the following layers need changes:

### Layer 1: Shared IPC Types (`src/shared/ipc-types.ts`)

Add three new event types to `SessionStreamEvent`:

```typescript
| { type: 'thinking_start' }
| { type: 'thinking_delta'; delta: string }
| { type: 'thinking_end' }
```

### Layer 2: Both `handleAgentEvent` Implementations

Update `src/main/session-manager.ts` and `src/main/threading/worker-bootstrap.ts`:

- Add handling for `thinking_start`, `thinking_delta`, `thinking_end` sub-events in the `message_update` case
- Add a `currentAssistantThinking` field to `ManagedSession` for accumulation
- Pass thinking deltas through the batcher

### Layer 3: StreamBatcher (`src/main/stream-batcher.ts`)

Extend `StreamBatcher.push()` to handle `thinking_delta` events the same way it handles `text_delta`:

```typescript
if (event.type === 'thinking_delta') {
    this.pendingThinking += event.delta
    // timer logic same as text_delta
}
```

### Layer 4: Renderer Types (`src/renderer/src/types/chat.ts`)

Add a new `ChatMessage` variant for thinking:

```typescript
| { role: 'assistant'; type: 'thinking'; content: string; id: string }
```

### Layer 5: UI Components

- **`useSessionEvents.ts`** — Handle `thinking_start`/`thinking_delta`/`thinking_end` IPC events
- **`AssistantMessage.tsx`** — Render thinking blocks in a collapsible/expandable section (common pattern: show "Thinking..." with a chevron, expandable to show reasoning content)
- **`message-transforms.ts`** — Add transformation for thinking events to `ChatMessage` type

### Layer 6: Message Store (Optional/Persistent)

- **`message-store.ts`** — Store thinking blocks with assistant messages for session replay
- **`ChatMessageIPC`** — Add optional `thinking` field to `ChatMessageIPC` for persistence

---

## Key Architectural Notes

1. **Thinking deltas arrive through the same `message_update` event** as text deltas. They are distinguished by `event.assistantMessageEvent.type` being `thinking_delta` vs `text_delta`.

2. **Thinking blocks interleave with text blocks** in `AssistantMessage.content`. An assistant message might have:
   ```
   [ThinkingContent, TextContent, ThinkingContent, TextContent, ToolCall]
   ```
   This means the UI must support rendering thinking blocks inline or as expandable sections within a single assistant message.

3. **Redacted thinking**: When `ThinkingContent.redacted` is `true`, the thinking content was stripped by safety filters. The `thinkingSignature` contains an opaque encrypted payload for API multi-turn continuity. NekoCode should show "Thinking redacted" or similar placeholder instead of the raw encrypted blob.

4. **Thinking can be disabled**: Pi's `ThinkingLevel` includes `"off"` as an option (via `ModelThinkingLevel`). When thinking is off, no thinking events will be emitted. NekoCode should always be prepared to handle the absence of thinking events gracefully.

5. **The worker thread and main process event handlers must stay in sync**: Both `worker-bootstrap.ts` (worker thread) and `session-manager.ts` (main process when not using threading) have identical `handleAgentEvent` implementations. Any changes must be applied to both.

---

## Git History Context

The current worker log line that shows thinking is being emitted but ignored:

```
2026-05-12 08:54:34 [worker] debug: handleAgentEvent: type=message_update
```

This confirms Pi is sending `message_update` events that contain thinking sub-events, but since NekoCode only processes `text_delta` sub-types, any `thinking_delta` sub-events within the same `message_update` are dropped into the `break` statement without any handling.

---

## References

- **Pi AI Types:** `node_modules/@earendil-works/pi-ai/dist/types.d.ts` (lines 103-109, 187-235, 265)
- **Pi Agent Core Types:** `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts` (lines 330-360)
- **Pi Coding Agent Session:** `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts` (lines 41-70)
- **Pi Thinking Selector Component:** `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/thinking-selector.d.ts`
- **NekoCode Stream Handler (main):** `src/main/session-manager.ts`
- **NekoCode Stream Handler (worker):** `src/main/threading/worker-bootstrap.ts`
- **NekoCode Stream Batcher:** `src/main/stream-batcher.ts`
- **NekoCode IPC Types:** `src/shared/ipc-types.ts`
- **NekoCode Chat Types:** `src/renderer/src/types/chat.ts`
