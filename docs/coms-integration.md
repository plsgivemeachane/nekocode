# Coms Integration — Inter-Agent Messaging in NekoCode

## Overview

**Coms** is the Pi ecosystem's inter-agent messaging system. It enables multiple Pi agent instances to discover each other, exchange prompts, and collaborate on tasks in real time. This document describes how NekoCode integrates coms into its Electron architecture.

The coms extension (`~/.pi/agent/extensions/coms.ts`) runs inside each Pi agent process and manages:

- **Registry**: Filesystem-based agent discovery under `~/.pi/coms/projects/`
- **Messaging**: Named pipe (Windows) / Unix domain socket (POSIX) transport
- **Wire protocol**: JSON-line envelopes with prompt/response/ack/nack/ping/pong message types

NekoCode provides a **UI layer** on top of this system, allowing users to:

- See which peer agents are online (in the sidebar)
- Send messages to peers directly from the UI
- Receive and view inbound messages from other agents
- Track context window usage of peer agents

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Renderer                      │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  ComsPeerList │  │    useComs hook          │ │
│  │  (sidebar UI) │◄─┤  • peers state           │ │
│  │               │  │  • inboundMessages state  │ │
│  └──────────────┘  │  • send / get / await     │ │
│                     └──────────┬───────────────┘ │
│                                │ window.nekocode.coms
├────────────────────────────────┤
│  Preload Bridge                │
│  coms.list / send / get /     │
│  await / onInbound             │
│  ↕ ipcRenderer.invoke / .on    │
├────────────────────────────────┤
│  Main Process                  │
│  ┌──────────────────────────┐  │
│  │    ComsManager            │  │
│  │  • Reads registry files   │  │
│  │  • Resolves targets       │  │
│  │  • Sends via named pipes  │  │
│  │  • Binds listener socket  │  │
│  │  • Forwards inbound → IPC │  │
│  └──────────────────────────┘  │
│         ↕                      │
│  IPC Handlers (coms:*)         │
│         ↕                      │
│  ~~~/.pi/coms/ filesystem      │
└─────────────────────────────────┘
```

---

## File Map

| Layer | File | Purpose |
|-------|------|----------|
| Shared | `src/shared/ipc-types.ts` | `ComsPeer`, `ComsListPayload/Result`, `ComsSendPayload/Result`, `ComsGetPayload/Result`, `ComsAwaitPayload/Result`, `ComsInboundEvent` types + `coms` property on `NekoCodeIPC` |
| Shared | `src/shared/ipc-channels.ts` | `COMS_LIST`, `COMS_SEND`, `COMS_GET`, `COMS_AWAIT`, `COMS_INBOUND` channel constants |
| Main | `src/main/coms-manager.ts` | `ComsManager` class — registry reading, named pipe communication, inbound message handling |
| Main | `src/main/ipc-handlers.ts` | IPC handler registration for coms channels |
| Main | `src/main/index.ts` | ComsManager instantiation, lifecycle (start/stop) |
| Preload | `src/preload/index.ts` | Bridge exposing `window.nekocode.coms.*` API to renderer |
| Renderer | `src/renderer/src/hooks/useComs.ts` | React hook providing reactive peer state, inbound messages, and send/get/await operations |
| Renderer | `src/renderer/src/components/coms/ComsPeerList.tsx` | Sidebar component showing peer list, inbound notifications, and quick-send modal |
| Renderer | `src/renderer/src/components/layout/TreeSidebar.tsx` | Integration point — hosts `ComsPeerList` in the sidebar |

---

## IPC Channels

| Channel | Direction | Payload | Result |
|---------|-----------|---------|--------|
| `coms:list` | Renderer → Main | `ComsListPayload?` | `ComsListResult` |
| `coms:send` | Renderer → Main | `ComsSendPayload` | `ComsSendResult` |
| `coms:get` | Renderer → Main | `ComsGetPayload` | `ComsGetResult` |
| `coms:await` | Renderer → Main | `ComsAwaitPayload` | `ComsAwaitResult` |
| `coms:inbound` | Main → Renderer | `ComsInboundEvent` | (event, no return) |

---

## ComsManager Details

### Registry Reading

The `ComsManager.list()` method reads directly from the coms registry filesystem:

```
~/.pi/coms/projects/
  └── <project-name>/
      └── agents/
          ├── <session-id>.json   ← Registry entry
          └── ...
```

Each registry entry JSON contains:

```typescript
{
  session_id: string     // Unique session identifier
  name: string           // Human-readable agent name
  purpose: string        // One-line description
  model: string          // Model identifier (e.g. "anthropic/claude-sonnet-4-20250514")
  color: string          // Brand color hex
  pid: number            // OS process ID
  endpoint: string       // Named pipe / Unix socket path
  cwd: string            // Working directory
  started_at: string     // ISO timestamp
  explicit: boolean      // Launched with --explicit flag
  version: number        // Registry schema version
  context_used_pct?: number  // Optional: context window usage %
}
```

### Liveness Checking

- **Windows**: Connects to the agent's named pipe endpoint and sends a ping
- **POSIX**: Uses `process.kill(pid, 0)` (signal 0 checks existence without killing)
- Stale registry entries (dead processes) are automatically cleaned up

### Message Sending

The `ComsManager.send()` method:

1. Resolves the target name/session_id to an endpoint via registry lookup
2. Constructs a JSON-line envelope with type `prompt`
3. Opens a connection to the endpoint's named pipe
4. Writes the envelope and waits for ACK
5. Returns a `msgId` for tracking the reply

### Inbound Message Handling

The `ComsManager` optionally binds a listener socket on its own endpoint. When an inbound prompt arrives:

1. The envelope is parsed from the socket
2. The prompt is forwarded to the renderer via the `coms:inbound` IPC event
3. An ACK is sent back to the sender

Response messages (type `response`) are matched against the pending replies map and resolved.

---

## Renderer Hook: `useComs`

The `useComs` hook provides:

```typescript
interface UseComsOutput {
  peers: ComsPeer[]                 // Current peer list
  loading: boolean                   // Whether peer list is loading
  error: string | null               // Last error
  inboundMessages: ComsInboundEvent[] // Unread inbound messages
  refresh: () => Promise<void>       // Manual refresh
  send: (payload) => Promise<ComsSendResult>
  get: (payload) => Promise<ComsGetResult>
  awaitReply: (payload) => Promise<ComsAwaitResult>
  dismissInbound: (msgId: string) => void
}
```

- **Peer list** is refreshed automatically every 15 seconds
- **Inbound messages** are received in real-time via IPC event
- **Send/Get/Await** wrap the preload bridge with error handling and state updates

---

## UI Component: `ComsPeerList`

The `ComsPeerList` component is embedded in the sidebar and provides:

### Peer List
- Compact rows showing agent name, model, and status dot (green = online, gray = offline)
- Color badge from the agent's brand color
- Context usage bar (green < 50%, yellow < 80%, red ≥ 80%)
- Expandable details with purpose, project, and "Send message" button

### Inbound Message Cards
- Highlighted cards with accent color for inbound prompts
- "Reply" button that opens the quick-send modal pre-addressed to the sender
- "Dismiss" button to clear the notification

### Quick-Send Modal
- Simple overlay dialog for composing a prompt to a peer
- Ctrl+Enter keyboard shortcut to send
- Shows sending state while the message is in transit

### Collapsible Section
- The entire peer list section can be collapsed via the header
- Shows alive/total agent count in the header

---

## Wire Protocol

The coms extension uses a JSON-line protocol over named pipes / Unix domain sockets:

| Message Type | Purpose | Fields |
|-------------|---------|--------|
| `prompt` | Send a prompt to a peer | `msg_id`, `sender_session`, `sender_endpoint`, `sender_name`, `prompt`, `conversation_id`, `response_schema`, `hops` |
| `response` | Reply to a previously sent prompt | `msg_id`, `response`, `hops` |
| `ack` | Acknowledge receipt | `msg_id`, `hops` |
| `nack` | Reject (unknown type, validation error) | `msg_id`, `reason` |
| `ping` | Liveness check | `msg_id`, `sender_session`, `sender_endpoint`, `hops` |
| `pong` | Liveness response | `msg_id`, `sender_session`, `sender_endpoint`, `hops` |

---

## Limitations & Future Work

- **No message persistence**: Inbound/outbound messages are only held in React state and lost on reload
- **No conversation threading**: The quick-send modal doesn't thread multi-turn conversations
- **No authentication**: Any process that can access the named pipe can send messages
- **Polling-based liveness**: On Windows, liveness checks require opening a pipe connection (costly)
- **Single-project scope**: The peer list defaults to the current project; cross-project requires `project: "*"`
- **No relay routing**: Messages go directly peer-to-peer; no multi-hop relay

### Planned Enhancements

1. **Conversation threading UI** — Group related messages by `conversation_id`
2. **Message persistence** — Store coms history in the message-store for reload resilience
3. **Agent delegation** — One-click "delegate this task" from chat to a specific peer
4. **Broadcast channel** — Send a prompt to all peers in a project simultaneously
5. **Relay mesh** — Multi-hop message routing for NAT-traversal scenarios
