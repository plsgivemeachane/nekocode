# Pi SDK: Slash Commands and Workflow Invocation in NekoCode

> Implementation reference for slash command discovery, invocation,
> extension UI protocol handling, and workflow progress in NekoCode.

---

## Table of Contents

1. [Overview](#overview)
2. [How Pi Slash Commands Work](#how-pi-slash-commands-work)
3. [SDK APIs for Command Discovery and Invocation](#sdk-apis-for-command-discovery-and-invocation)
4. [Current NekoCode Architecture](#current-nekocode-architecture)
5. [Phase 1: Core Slash Commands — ✅ DONE](#phase-1-core-slash-commands--done)
6. [Phase 2: Extension UI + Workflows — ✅ DONE](#phase-2-extension-ui--workflows--done)
7. [Phase 3: Polish — ❌ NOT IMPLEMENTED](#phase-3-polish--not-implemented)
8. [Reference: Command Types and Sources](#reference-command-types-and-sources)
9. [Implementation Changelog](#implementation-changelog)

---

## Overview

NekoCode lets users invoke Pi slash commands (like /deploy, /review, /compact)
and trigger workflows from inside the desktop UI. This document covers:

- How Pi slash commands are discovered and invoked via the SDK
- What NekoCode implements for command discovery, autocomplete, and invocation
- Extension UI protocol handling (select/confirm/input dialogs)
- Workflow step progress tracking in the chat timeline
- What remains unimplemented (Phase 3 polish features)

The key insight: **Pi already handles slash command parsing inside session.prompt()**.
NekoCode does NOT reimplement command routing. It:

1. Discovers available commands (for autocomplete / command palette UI)
2. Passes /command text through the existing prompt pipeline
3. Handles the extension UI sub-protocol (confirm, select, input dialogs)
4. Tracks and displays workflow step progress

---

## How Pi Slash Commands Work

Pi supports three kinds of slash commands, all invoked by typing /name in the prompt:

### 1. Prompt Template Commands (.md files)

Simple text expansion. A .md file in a prompts directory becomes a slash command.

- Location: ~/.pi/agent/prompts/ (user-level) or .pi/prompts/ (project-level)
- Example: .pi/prompts/fix-tests.md becomes /fix-tests
- Behavior: The file content replaces the /fix-tests text before being sent to the LLM
- No code execution - pure text substitution

### 2. Extension Commands (pi.registerCommand())

Programmatic commands registered by extension hooks. Full code control with UI access.

- Registered via: pi.registerCommand(name, description, handler) in extension files
- Handler receives: HookCommandContext with args, ui, sessionManager, modelRegistry
- Can: Show dialogs (select/confirm/input), execute shell commands, send messages to LLM
- Behavior: Execute immediately even during streaming. They manage their own LLM interaction via pi.sendMessage()

### 3. Skill Commands

Skills that have a SKILL.md become invocable as /skill:name.

- Location: ~/.pi/agent/skills/ or .pi/skills/
- Example: skills/brave-search/SKILL.md becomes /skill:brave-search
- Behavior: Loaded and expanded before sending to LLM

### Invocation Flow

When a user types /mycommand arg1 arg2:

1. The text is passed to session.prompt('/mycommand arg1 arg2')
2. Pi checks if /mycommand is a registered extension command
   - Yes: Calls the command handler immediately. Handler can use pi.sendMessage() to interact with LLM
   - No: Checks if it is a prompt template or skill
3. If it is a prompt template: the .md content replaces the command text, then sent to LLM
4. If it is a skill: the SKILL.md is loaded and the skill instructions are injected

Important: Extension commands execute immediately even during streaming.
Prompt templates and skills are expanded before sending/queueing.

---

## SDK APIs for Command Discovery and Invocation

### Invoking Commands (Already Works!)

The simplest way to invoke a slash command from NekoCode is to pass the
slash command text directly through the existing prompt pipeline:

    // NekoCode already does this in PiSessionManager.prompt()
    await managed.session.prompt('/compact')
    await managed.session.prompt('/skill:brave-search find pi docs')
    await managed.session.prompt('/my-custom-prompt')

This works because session.prompt() internally handles slash command expansion
and routing. No special handling is needed on the NekoCode side.

### Discovering Available Commands (SDK)

Commands are discovered at runtime from a live session's ResourceLoader
and ExtensionRunner. These are synchronous APIs:

    // Access from a live session
    const loader = managed.session.resourceLoader
    const runner = managed.session.extensionRunner

    // Get discovered prompt templates (SYNCHRONOUS)
    const { skills } = loader.getSkills()
    // Each Skill has: { name: string, description: string }
    // Invocable as /skill:{name}

    // Get discovered prompt templates (SYNCHRONOUS)
    const { prompts } = loader.getPrompts()
    // Each PromptTemplate has: { name: string, description: string }
    // name is the slash command name (e.g., 'fix-tests')

    // Get runtime-registered extension commands (SYNCHRONOUS)
    const commands = runner.getRegisteredCommands()
    // Each RegisteredCommand has: { invocationName: string, description?: string, handler: Function }

> **Note:** The above APIs are synchronous, not async. The doc previously
> incorrectly referenced `loader.promises()` which does not exist in the SDK.
> The correct methods are `loader.getSkills()` and `loader.getPrompts()`.

### Key SDK Types

    // From @earendil-works/pi-coding-agent (actual SDK types)

    // Prompt template entry
    interface PromptTemplate {
      name: string        // Command name without / (e.g., 'fix-tests')
      description: string  // Description for autocomplete
    }

    // Skill entry
    interface Skill {
      name: string        // Skill name
      description: string // From SKILL.md frontmatter
    }

    // Extension command (runtime-registered)
    interface RegisteredCommand {
      invocationName: string              // Command name without /
      description?: string                // Optional description for autocomplete
      handler: (ctx: HookCommandContext) => Promise<void>  // The handler function
    }

> **Note:** The doc previously invented fields (`path`, `content`, `directory`)
> that do not exist on the SDK types. The actual types only expose `name` and
> `description`. NekoCode's implementation correctly uses only these fields.

### Session.prompt() Options Relevant to Commands

    interface PromptOptions {
      expandPromptTemplates?: boolean   // Default: true. Expand .md commands
      images?: ImageContent[]           // Attach images
      streamingBehavior?: 'steer' | 'followUp'  // Queueing during streaming
      source?: InputSource              // Where the input came from
      preflightResult?: (success: boolean) => void  // Acceptance callback
    }

Key behavior for slash commands:
- Extension commands (/registered-command): Execute immediately, even during streaming
- File-based prompt templates (/template-name): Expanded before sending or queueing
- During streaming without streamingBehavior: Throws an error for non-commands
- preflightResult(true) means the prompt was accepted, queued, or handled immediately

---

## Current NekoCode Architecture

### How Prompts Flow

    [ChatInput.tsx]
         |
         | sendPrompt(text)
         v
    [useSession.ts]
         |
         | window.nekocode.session.prompt(sessionId, text)
         v
    [preload/index.ts]
         |
         | ipcRenderer.invoke('session:prompt', { sessionId, text })
         v
    [ipc-handlers.ts]
         |
         | sessionManager.prompt(sessionId, text)
         v
    [session-manager.ts OR threaded-session-manager.ts]
         |
         | managed.session.prompt(text, { streamingBehavior: 'steer' })
         v
    [Pi SDK - AgentSession]
         |
         | (handles slash command expansion + routing internally)
         v
    [LLM / Extension Command Handler]

### Command Discovery Flow

    [ChatInput.tsx] or [GlobalCommandPalette.tsx]
         |
         | useCommands({ sessionId }) hook
         v
    [useCommands.ts]
         |
         | window.nekocode.session.getCommands(sessionId)
         v
    [preload/index.ts]
         |
         | ipcRenderer.invoke('session:get-commands', { sessionId })
         v
    [ipc-handlers.ts]
         |
         | sessionManager.getCommands(sessionId)
         v
    [session-manager.ts OR worker-bootstrap.ts]
         |
         | Collects from extensionRunner + resourceLoader
         | Deduplicates by name
         v
    [CommandInfo[]] → renderer

### Extension UI Protocol Flow

    [Pi SDK Extension Command]
         |
         | ctx.ui.select() / ctx.ui.confirm() / ctx.ui.input()
         v
    [ElectronUIContext] (implements ExtensionUIContext)
         |
         | Sends UIRequest via transport (main thread IPC or worker parentPort)
         v
    [Session Events] → ui_request event type
         |
         | ipcRenderer.on('session:events')
         v
    [useUIRequests hook]
         |
         | Stores pending request, provides confirm/cancel
         v
    [UIDialog component] (rendered in MessagesTimeline)
         |
         | User interacts → confirm or cancel
         v
    [window.nekocode.session.uiRespond(response)]
         |
         | ipcRenderer.invoke('session:ui-respond', response)
         v
    [ElectronUIContext.handleResponse()]
         |
         | Resolves the pending Promise
         v
    [Extension Command resumes]

### Key Files

| File | Role |
|------|------|
| src/shared/ipc-channels.ts | IPC channel name constants |
| src/shared/ipc-types.ts | Type definitions: CommandInfo, UIRequest, UIResponse, SessionStreamEvent, NekoCodeIPC |
| src/main/session-manager.ts | PiSessionManager — getCommands(), handleUIResponse() |
| src/main/threading/worker-bootstrap.ts | Worker thread: handleSessionGetCommands(), handleSessionUIRespond() |
| src/main/threading/types.ts | Thread operation types (session:get-commands, session:ui-respond) |
| src/main/electron-ui-context.ts | ElectronUIContext — implements SDK ExtensionUIContext, forwards UI requests to renderer |
| src/main/ipc-handlers.ts | IPC handler registration for getCommands and uiRespond |
| src/preload/index.ts | Exposes window.nekocode to renderer: getCommands, uiRespond, onUIRequest |
| src/renderer/src/hooks/useCommands.ts | Hook for fetching, caching, filtering, and sorting commands (recent-first) |
| src/renderer/src/hooks/useCommandHistory.ts | Command usage history tracking with localStorage persistence |
| src/renderer/src/hooks/useUIRequests.ts | Hook for managing pending UI requests from extensions/workflows |
| src/renderer/src/hooks/useWorkflowSteps.ts | Hook for tracking workflow step progress |
| src/renderer/src/components/chat/CommandPalette.tsx | Inline slash autocomplete dropdown (triggered by / in ChatInput) |
| src/renderer/src/components/chat/GlobalCommandPalette.tsx | Modal command palette (triggered by Ctrl+Shift+P) |
| src/renderer/src/components/chat/UIDialog.tsx | Unified dialog component: SelectDialogContent, ConfirmDialogContent, InputDialogContent |
| src/renderer/src/components/chat/WorkflowStepProgress.tsx | Workflow step progress display in chat timeline |
| src/renderer/src/components/chat/ChatInput.tsx | Text input with slash command autocomplete integration |
| src/renderer/src/components/chat/ChatView.tsx | Wires UI protocol, workflow tracking, global palette into message timeline |

### Current IPC Session Interface

    // From NekoCodeIPC in ipc-types.ts
    session: {
      create(cwd): Promise<SessionCreateResult>
      prompt(sessionId, text): Promise<void>          // slash commands work here
      abort(sessionId): Promise<void>
      dispose(sessionId): Promise<void>
      deleteSession(sessionId, cwd): Promise<void>
      reconnect(sessionId, cwd): Promise<SessionReconnectResult>
      loadHistory(sessionId): Promise<ChatMessageIPC[]>
      loadHistoryFromDisk(sessionId, cwd, limit): Promise<ChatMessageIPC[]>
      onEvent(callback: (payload: { sessionId: string; event: SessionStreamEvent }) => void): () => void
      getModel(sessionId): Promise<ModelInfo | null>
      listModels(): Promise<ModelInfo[]>
      setModel(sessionId, provider, modelId): Promise<ModelInfo>
      getCommands(sessionId): Promise<CommandInfo[]>    // ✅ Phase 1
      uiRespond(response): Promise<void>                // ✅ Phase 2
      onUIRequest(callback): () => void                 // ✅ Phase 2
    }

---

## Phase 1: Core Slash Commands — ✅ DONE

### What Was Planned

1. Add getCommands IPC channel and types
2. Implement command discovery in session manager
3. Add slash autocomplete dropdown to ChatInput
4. Wire sendPrompt to pass /command text through existing pipeline

### What Was Actually Implemented

#### 1. IPC Channel and Types

**File: src/shared/ipc-channels.ts**

    SESSION_GET_COMMANDS: 'session:get-commands'

> Note: The original plan proposed three separate channels
> (session:get-commands, session:get-prompts, session:get-skills).
> Implementation correctly uses a single unified channel that returns
> all command types in one call.

**File: src/shared/ipc-types.ts**

    export interface CommandInfo {
      name: string              // Command name without / (e.g., 'deploy', 'skill:brave-search')
      description?: string      // Human-readable description for autocomplete
      source: 'extension' | 'prompt' | 'skill' | 'workflow'
    }

> Note: The `workflow` source type is included in the type union even though
> workflow discovery is not yet implemented. This is forward-looking for
> when the SDK exposes workflow metadata.

#### 2. Command Discovery

Implemented in both session-manager.ts and worker-bootstrap.ts:

- **Extension commands**: Via `managed.session.extensionRunner.getRegisteredCommands()`
- **Skills**: Via `managed.session.resourceLoader.getSkills()` (sync API)
- **Prompts**: Via `managed.session.resourceLoader.getPrompts()` (sync API)
- **Deduplication**: Uses a `Set<string>` to prevent duplicate command names
- **Error handling**: Wrapped in try/catch for graceful degradation

> Note: The original plan proposed DefaultResourceLoader for static discovery.
> Implementation uses live session discovery only (requires an active session).
> This is acceptable because commands are only needed when a session is active.

#### 3. Slash Autocomplete Dropdown

**File: src/renderer/src/components/chat/CommandPalette.tsx**

- Triggered by typing `/` in ChatInput
- Filters commands by prefix after `/`
- Shows command name, source badge (color-coded by type), and description
- Keyboard navigation: Arrow Up/Down, Tab to select, Enter to send
- Source badge colors: extension=purple, prompt=blue, skill=green, builtin=yellow

**File: src/renderer/src/hooks/useCommands.ts**

- Fetches commands via `window.nekocode.session.getCommands(sessionId)`
- Caches per session, refetches on session change
- Provides `{ commands, isLoading, refreshCommands, filterCommands, recordCommandUsage, getRecentCommandNames, getCommandHistory }`
- **No `error` field** — errors are caught silently and result in an empty command list
- **`commands` is pre-sorted**: recently-used commands first (via `useCommandHistory`), then alphabetically by name
- Integrates `useCommandHistory` for persistence (localStorage, key `nekocode:command-history`, max 10 entries)

#### 4. ChatInput Integration

**File: src/renderer/src/components/chat/ChatInput.tsx**

- Detects `/` at start of input or after whitespace
- Shows CommandPalette overlay when slash is detected
- On selection: records command usage via `recordCommandUsage(name, source)`, replaces input with full command name + space
- Passes `recentCommandNames` to CommandPalette for "Recent" / "Other" section splitting
- On Enter with selection: sends the command through existing sendPrompt()

#### 5. Additional Wiring

- **ipc-handlers.ts**: Handler registered for SESSION_GET_COMMANDS
- **preload/index.ts**: `getCommands` exposed on `window.nekocode.session`
- **worker-bootstrap.ts**: `handleSessionGetCommands()` for worker-threaded sessions
- **threading/types.ts**: `session:get-commands` operation type with input/output types
- **test-utils.tsx**: `getCommands` mocked in test utilities

---

## Phase 2: Extension UI + Workflows — ✅ DONE

### What Was Planned

1. Add UI protocol event types (ui:select, ui:confirm, ui:input)
2. Add uiRespond IPC channel
3. Create dialog components (SelectDialog, ConfirmDialog, InputDialog)
4. Add workflow step progress display in chat timeline
5. Add command palette UI (Ctrl+Shift+P style)

### What Was Actually Implemented

#### 1. UI Protocol Event Types

**File: src/shared/ipc-types.ts**

The UI protocol uses a single `ui_request` event type with sub-types, not
three separate event types as originally planned:

    // SessionStreamEvent union includes:
    | { type: 'ui_request'; request: UIRequest }
    | { type: 'workflow_step'; step: WorkflowStepEvent }

    // UIRequest is a SINGLE interface with optional fields based on type:
    export interface UIRequest {
      id: string               // Unique request ID
      sessionId: string        // Session this request belongs to
      type: 'select' | 'confirm' | 'input'
      title: string            // Dialog heading
      description?: string     // Optional body/description text
      options?: UISelectOption[]  // For 'select' type only
      placeholder?: string     // For 'input' type only
      defaultValue?: string    // For 'input' type only
      dangerous?: boolean      // For 'confirm' type: destructive style
    }

    // Options for select dialogs (NOT plain strings)
    export interface UISelectOption {
      label: string           // Display label
      description?: string    // Optional sub-description
      value?: string          // Value sent back (defaults to label if omitted)
    }

    // UIResponse for sending answers back:
    export interface UIResponse {
      requestId: string          // Matches UIRequest.id
      sessionId: string
      confirmed: boolean         // true = user confirmed/selected, false = cancelled
      selectedValue?: string     // For 'select' type: the chosen option value
      inputValue?: string        // For 'input' type: the entered text
    }

#### 2. UI Respond IPC Channel

**File: src/shared/ipc-channels.ts**

    SESSION_UI_RESPOND: 'session:ui-respond'

**File: src/shared/ipc-types.ts**

    // Added to NekoCodeIPC.session:
    uiRespond(response: UIResponse): Promise<void>
    onUIRequest(callback: (request: UIRequest) => void): () => void

> Note: The original plan proposed `uiRespond(sessionId, requestId, response)`
> with a simple string/boolean. Implementation uses a structured `UIResponse`
> object with `requestId`, `sessionId`, `confirmed` boolean, and type-specific
> fields (`selectedValue`, `inputValue`). No `type` discriminator in the response —
> the main process identifies the request type from the pending request.

#### 3. ElectronUIContext (Main Process)

**File: src/main/electron-ui-context.ts**

Implements the Pi SDK `ExtensionUIContext` interface, bridging SDK UI calls
to the Electron renderer:

- `select(options)`: Creates a UISelectRequest, sends to renderer, awaits response
- `confirm(message)`: Creates a UIConfirmRequest, sends to renderer, awaits response
- `input(message, defaultValue?)`: Creates a UIInputRequest, sends to renderer, awaits response
- `handleResponse(response)`: Resolves the pending Promise when renderer responds
- Supports AbortSignal for cancellation
- **MainThreadUITransport**: Sends directly via BrowserWindow webContents
- **WorkerThreadUITransport**: Forwards via parentPort to main thread

#### 4. Dialog Components

**File: src/renderer/src/components/chat/UIDialog.tsx**

A unified component with three content variants (not three separate components):

- **SelectDialogContent**: Clickable option buttons with keyboard navigation (Arrow keys, Enter to confirm, Escape to cancel). Each option shows label and optional description.
- **ConfirmDialogContent**: Message with Confirm/Cancel buttons, auto-focuses confirm button
- **InputDialogContent**: Text field with submit button, auto-focuses input, Enter to submit

All variants share:
- Consistent styling matching ToolCallGroup/ThinkingBlock aesthetic
- Cancel support (responds with `confirmed: false`)
- Local state management via `updateLocalState` callback
- Confirm sends `UIResponse` with `confirmed: true` plus type-specific fields
  (`selectedValue` for select, `inputValue` for input, neither for confirm)

#### 5. useUIRequests Hook

**File: src/renderer/src/hooks/useUIRequests.ts**

- Listens for `ui_request` events via `window.nekocode.session.onUIRequest()`
- Stores the active pending request
- Provides `updateLocalState`, `confirm`, `cancel` methods
- Only one request active at a time (new requests replace old)

#### 6. Workflow Step Progress

**File: src/renderer/src/components/chat/WorkflowStepProgress.tsx**

Displays workflow execution progress in the chat timeline:
- Step status dots: running (spinner), completed (check), failed (X), waiting (clock)
- Step name and status label
- Collapsible step details

**File: src/renderer/src/hooks/useWorkflowSteps.ts**

- Tracks workflow execution via session stream events
- Maintains a Map of tracked workflows keyed by workflow ID
- Updates step statuses as events arrive

#### 7. Global Command Palette (Ctrl+Shift+P)

**File: src/renderer/src/components/chat/GlobalCommandPalette.tsx**

- Modal overlay with its own search input
- Triggered by `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
- Same source badge colors as inline CommandPalette
- Keyboard navigation: Arrow keys, Enter to select and send
- Escape to close
- Renders via React portal
- **Recent commands section**: When no search query is active, splits commands into "Recent" and "Other" sections (via `recentCommandNames` prop)
- Props: `{ visible, commands, isLoading, onSelect, onClose, recentCommandNames?: Set<string> }`

**File: src/renderer/src/components/chat/ChatView.tsx**

- Global keyboard handler for Ctrl+Shift+P toggle
- On command selection: records usage via `recordCommandUsage(name, source)`, inserts command name into chat input, and sends via `sendPrompt()`
- Integrates `useCommands` (which provides `recordCommandUsage`, `getRecentCommandNames`), `useUIRequests`, `useWorkflowSteps`, and `GlobalCommandPalette`
- Passes `getRecentCommandNames()` as `recentCommandNames` prop to GlobalCommandPalette

#### 8. MessagesTimeline Integration

**File: src/renderer/src/components/chat/ChatView.tsx** (renderRow)

The message timeline now handles additional row types:

- `ui-dialog`: Renders `<UIDialog>` when an active UI request exists
- `workflow-step`: Renders `<WorkflowStepProgress>` for tracked workflows

These are rendered inline in the message flow alongside tool calls and thinking blocks.

#### 9. Full IPC Pipeline

- **ipc-handlers.ts**: Handler for `SESSION_UI_RESPOND` calls `sessionManager.handleUIResponse()`
- **session-manager.ts**: `handleUIResponse()` forwards to `managed.uiContext.handleResponse()`
- **worker-bootstrap.ts**: `handleSessionUIRespond()` for worker-threaded sessions
- **threading/types.ts**: `session:ui-respond` operation type
- **preload/index.ts**: `uiRespond` and `onUIRequest` exposed on `window.nekocode.session`

---

## Phase 3: Polish — 🔧 PARTIALLY IMPLEMENTED (1/5 done, #1 fully complete)

### What Was Planned

1. **Command history (recently used commands)** ✅ DONE
   - Track which commands the user invokes
   - Surface recently used commands at the top of the palette
   - **Implementation:**
     - `useCommandHistory.ts`: Tracks usage with `recordUsage(name, source)`, persists to localStorage (`nekocode:command-history`, max 10 entries), provides `getRecentNames()` and `getHistory()`
     - `useCommands.ts`: Uses `useCommandHistory` internally, returns `sortedCommands` (recent first, then alphabetical), exposes `recordCommandUsage` and `getRecentCommandNames`
     - `GlobalCommandPalette.tsx`: Accepts `recentCommandNames` prop, splits into "Recent" and "Other" sections when no search query
     - `ChatView.tsx`: Records usage on global palette selection via `recordCommandUsage(name, source)`, passes `getRecentCommandNames()` to GlobalCommandPalette
     - `ChatInput.tsx`: Records usage on inline palette selection via `recordCommandUsage(name, source)`, passes `recentCommandNames` computed from `getRecentCommandNames()` to inline `CommandPalette`

2. **Keyboard shortcuts for common commands**
   - e.g., Ctrl+Shift+C for /compact, Ctrl+Shift+D for /diff
   - Status: Not implemented. Only Ctrl+Shift+P for the global palette exists.

3. **Workflow builder UI**
   - Visual editor for creating/editing workflow YAML files
   - Status: Not implemented. No workflow editing UI exists.

4. **Inline command documentation (hover)**
   - Hover over a command in the palette to see full documentation
   - Status: Not implemented. Only `name` and `description` are shown.

5. **Command suggestion based on context**
   - Suggest relevant commands based on current file type, git status, etc.
   - Status: Not implemented. Commands are listed with recently-used first then alphabetically, with search filtering only.

---

## Reference: Command Types and Sources

### Built-in Pi Commands

These commands are always available in Pi:

| Command | Type | Description |
|---------|------|-------------|
| /compact | extension | Compact conversation context |
| /clear | extension | Clear conversation history |
| /help | extension | Show available commands |
| /model | extension | Switch or show current model |
| /cost | extension | Show token usage and costs |
| /undo | extension | Undo last assistant message |
| /bug | extension | Report a bug |
| /diff | extension | Show pending changes diff |
| /memory | extension | View/edit agent memory |
| /init | extension | Initialize Pi configuration |

### Extension Command Registration Pattern

Extensions register commands in their hook files:

    // .pi/hooks/commands.ts
    export default function registerCommands(pi) {
      pi.registerCommand('deploy', {
        description: 'Deploy the current project',
        handler: async (ctx) => {
          const env = await ctx.ui.select({
            message: 'Select environment',
            options: ['staging', 'production']
          })
          await ctx.sessionManager.sendMessage(
            'Deploy the project to ' + env + ' environment'
          )
        }
      })
    }

### Prompt Template Location

    User-level:   ~/.pi/agent/prompts/*.md
    Project-level: .pi/prompts/*.md

Each .md file becomes a /command matching its filename (without .md extension).

### Skill Location

    User-level:   ~/.pi/agent/skills/*/SKILL.md
    Project-level: .pi/skills/*/SKILL.md

Each SKILL.md becomes a /skill:directory-name command.

### Workflow Location

    User-level:   ~/.pi/agent/workflows/*.yaml
    Project-level: .pi/workflows/*.yaml

Each YAML file becomes a /workflow-name command.

---

## Implementation Changelog

### Doc Corrections from Initial Design

The original design document (pre-implementation) contained several inaccuracies
that were corrected during implementation:

1. **`loader.promises()` does not exist** — The doc referenced an async API
   `await loader.promises()`. The actual SDK exposes synchronous methods:
   `loader.getSkills()` and `loader.getPrompts()`. No `await` needed.

2. **PromptEntry type was wrong** — The doc defined `{ name, path, content }`.
   The actual SDK type is `PromptTemplate { name, description }`. No `path` or
   `content` fields exist.

3. **SkillEntry type was wrong** — The doc defined `{ name, path, description }`.
   The actual SDK type is `Skill { name, description }`. No `path` field exists.

4. **CommandInfo.source was incomplete** — The doc defined
   `source: 'extension' | 'prompt' | 'skill'`. Implementation includes
   `'workflow'` in the union for forward compatibility.

5. **Separate IPC channels were unnecessary** — The doc proposed three channels
   (get-commands, get-prompts, get-skills). Implementation correctly uses one
   unified `session:get-commands` channel.

6. **DefaultResourceLoader static discovery was not used** — The doc recommended
   a static fallback for when no session is active. Implementation uses live
   session discovery only via `managed.session.resourceLoader` and
   `managed.session.extensionRunner`. This is acceptable since commands are
   only needed in active sessions.

7. **UI protocol events use a single type** — The doc proposed three separate
   event types (`ui:select`, `ui:confirm`, `ui:input`). Implementation uses
   a single `ui_request` event with a single `UIRequest` interface (not a
   discriminated union of three interfaces). Fields use `id` (not `requestId`)
   and `title` (not `message`). Select options use `UISelectOption[]` with
   `label`/`description`/`value` (not `string[]`). Additional fields include
   `description?`, `placeholder?`, `dangerous?`.

8. **UIResponse is structured** — The doc proposed simple `string | boolean`.
   Implementation uses `UIResponse { requestId, sessionId, confirmed: boolean,
   selectedValue?, inputValue? }`. No `type` field or `value` union — the
   response uses `confirmed` boolean plus optional type-specific fields.

9. **IPC bridge name** — The doc referenced `window.nekoIPC`. The actual bridge
   is `window.nekocode`.

10. **Extension command discovery method** — The doc suggested listening for
    registration events or parsing source files. Implementation uses the direct
    SDK method `extensionRunner.getRegisteredCommands()`.

### Additional Corrections (2026-05-16 Verification Pass)

The initial rewrite fixed the 11 original inaccuracies but introduced new ones
in the Phase 2 type definitions. These were caught and corrected during a
codebase verification:

11. **UIRequest is a single interface, not a discriminated union** — The rewrite
    incorrectly showed `UIRequest = UISelectRequest | UIConfirmRequest | UIInputRequest`.
    The actual type is a single `UIRequest` interface with optional fields gated
    by the `type` discriminator.

12. **UIRequest field names wrong** — The rewrite used `requestId` and `message`.
    Actual fields are `id` and `title`.

13. **UISelectOption type missing** — The rewrite showed `options: string[]`.
    Actual type is `UISelectOption[]` with label/description/value fields.

14. **UIResponse structure wrong** — The rewrite showed a `type` discriminator
    and `value: string | boolean | null`. Actual type uses `confirmed: boolean`
    plus optional `selectedValue?` and `inputValue?` fields.

15. **UIDialog cancel behavior** — Described as "responds with null".
    Actual behavior sends `confirmed: false` with no value fields.

16. **onEvent callback signature** — Shown as simplified `onEvent(callback)`.
    Actual signature passes a payload with sessionId and event fields.

### Verification Corrections (2026-05-16 Second Pass)

Further verification against the source code revealed these additional inaccuracies:

17. **useCommands return type was incomplete** — Doc showed `{ commands, isLoading, error }`.
    Actual return type is `{ commands, isLoading, refreshCommands, filterCommands,
    recordCommandUsage, getRecentCommandNames, getCommandHistory }`. No `error` field
    exists — errors are caught silently.

18. **useCommands commands are pre-sorted** — Doc did not mention that `commands` is
    sorted with recently-used first, then alphabetically. This sorting is done by
    `useCommandHistory` integration inside `useCommands`.

19. **Phase 3 #1 (Command History) marked as "Not implemented"** — Command history
    IS fully implemented via `useCommandHistory.ts` with localStorage
    persistence, `useCommands.ts` sorting, `GlobalCommandPalette.tsx` recent section,
    and `ChatView.tsx` usage recording. The inline `CommandPalette` in
    `ChatInput.tsx` now also passes `recentCommandNames` (fixed 2026-05-16).

20. **GlobalCommandPalette missing recentCommandNames prop** — Doc showed props
    `{ visible, commands, isLoading, onSelect, onClose }`. Actual props include
    `recentCommandNames?: Set<string>`. The component splits into "Recent" and
    "Other" sections when no search query is active.

21. **GlobalCommandPalette props were incomplete** — Doc was missing
`recentCommandNames` prop and the "Recent"/"Other" section split feature.

22. **useCommands.ts return type was incomplete** — Doc showed only
`{ commands, isLoading, error }`. Actual return includes `refreshCommands`,
`filterCommands`, `recordCommandUsage`, `getRecentCommandNames`,
`getCommandHistory`. No `error` field exists.

### Phase 3 #1 Completion Fix (2026-05-16)

23. **Inline CommandPalette missing recentCommandNames** — The inline `/` palette
    in `ChatInput.tsx` did not pass `recentCommandNames` to `CommandPalette`,
    so the "Recent" / "Other" section split only appeared in the global
    Ctrl+Shift+P palette. **Fixed:** `ChatInput.tsx` now destructures
    `recordCommandUsage` and `getRecentCommandNames` from `useCommands`,
    passes `recentCommandNames` to `CommandPalette`, and records command
    usage on inline palette selection. Phase 3 #1 is now fully complete.

### Line Count Purge (2026-05-16)

24. **All file line counts removed** — Line counts are meaningless vanity metrics
that immediately go stale. Removed all `(... lines)` annotations from every file
reference in this document. We measure by feature completion, not line count.
Rewrote changelog items 21 and 22 to describe the actual issue (missing/incomplete
API surface) instead of whining about line counts.
