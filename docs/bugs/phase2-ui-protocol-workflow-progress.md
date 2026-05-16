# Phase 2: UI Protocol Events & Workflow Step Progress — Implementation Notes

## Date: 2026-05-16

## Summary

Implemented Phase 2 of the slash commands and workflows design (`docs/pi-slash-commands-and-workflows.md`). Phase 2 covers UI protocol events (ui:select, ui:confirm, ui:input), workflow step progress rendering in the chat timeline, and a global command palette triggered by Ctrl+Shift+P.

## What Was Implemented

### 1. useUIRequests Hook (`src/renderer/src/hooks/useUIRequests.ts`)
- Listens for `ui_request` events via `window.nekocode.session.onUIRequest()`
- Manages a single active dialog request with local state (highlighted index for select, input text for input)
- Provides `confirm()` and `cancel()` methods that call `window.nekocode.session.uiRespond()`
- Defensive: ignores requests for other sessions, ignores new requests while one is active
- Subscribes/unsubscribes based on sessionId lifecycle

### 2. useWorkflowSteps Hook (`src/renderer/src/hooks/useWorkflowSteps.ts`)
- Listens for `workflow_step` events via `window.nekocode.session.onEvent()`
- Maintains a `Map<string, TrackedWorkflow>` of active/visible workflows
- Each TrackedWorkflow tracks all step events keyed by stepIndex
- Provides `getWorkflow(id)` and `getActiveWorkflow()` accessors
- Reactively updates via `useState` for rendering; also maintains a ref for non-reactive access

### 3. UIDialog Component (`src/renderer/src/components/chat/UIDialog.tsx`)
- Renders three dialog types inline in the chat timeline:
  - **SelectDialog**: List of options with keyboard navigation (arrow keys, Enter to select, Esc to cancel)
  - **ConfirmDialog**: OK/Cancel buttons with dangerous state styling
  - **InputDialog**: Text input with Enter to submit, Esc to cancel
- Visual style matches existing ToolCallGroup/ThinkingBlock: dark border, header bar with icon + type label, monospace font
- Each sub-dialog manages its own keyboard handler via `useEffect`

### 4. WorkflowStepProgress Component (`src/renderer/src/components/chat/WorkflowStepProgress.tsx`)
- Renders workflow execution progress as an inline block in the chat timeline
- Header shows workflow name, active status, completion count
- Thin progress bar with animated width transitions
- Step list with status icons: checkmark (completed), X (failed), pulsing dot (running), clock (waiting)
- Matches ToolCallGroup visual style

### 5. ChatView Integration (`src/renderer/src/components/chat/ChatView.tsx`)
- Extended `MessageGroup` union type with `ui-dialog` and `workflow-step` variants
- Active UI dialog and tracked workflows are appended as rows to the message groups array
- `renderRow` handler extended to render UIDialog and WorkflowStepProgress components
- Type-safe narrowing ensures `.msg` is only accessed on `single` type groups

### 6. Global Command Palette (`src/renderer/src/components/chat/GlobalCommandPalette.tsx`)
- Modal overlay triggered by Ctrl+Shift+P global keyboard shortcut
- Portal-rendered to `document.body` with backdrop blur
- Search input filters commands by name and description
- Keyboard navigation (arrow keys, Enter, Esc)
- Source badges colored by type (extension=purple, skill=blue, prompt=green)
- On select: inserts command name into ChatInput and sends it
- Integrated into ChatView via `useCommands` hook + `useEffect` for the shortcut

### 7. Pre-existing Issue Fixes
While implementing Phase 2, several pre-existing lint/type errors from Phase 1 were fixed:
- `electron-ui-context.ts`: Fixed logger import (was `import { logger }`, now `createLogger`), removed `implements ExtensionUIContext` (interface is too large for partial implementation), added eslint-disable for legitimate `any` casts and `require()` calls
- `session-manager.ts`: Added eslint-disable for `as any` cast on uiContext binding
- `worker-bootstrap.ts`: Removed unused `UIResponse` import, added eslint-disable for `require()` call
- `test-utils.tsx`: Added `uiRespond` and `onUIRequest` mocks to the test session API
- `ipc-channels.test.ts`: Updated expected channel list to include `SESSION_UI_RESPOND` and `SESSION_UI_REQUEST`

## Backend Infrastructure (Already Existed — Phase 1)

The following were already implemented and required no changes:
- `UIRequest`, `UIResponse`, `UISelectOption`, `WorkflowStepEvent` types in `shared/ipc-types.ts`
- `SESSION_UI_RESPOND`, `SESSION_UI_REQUEST` channels in `shared/ipc-channels.ts`
- `session:ui-respond` IPC handler in `main/ipc-handlers.ts`
- `ElectronUIContext` class in `main/electron-ui-context.ts`
- `session.handleUIResponse()` in `main/session-manager.ts`
- `uiRespond()` and `onUIRequest()` in `preload/index.ts`
- `ui_request` and `workflow_step` variants in `SessionStreamEvent` union type

## Design Decisions

1. **Inline timeline rendering, not overlay**: UI dialogs and workflow progress render as rows inside MessagesTimeline, not as floating overlays. This keeps the conversation flow coherent — the dialog appears exactly where the AI requested it.

2. **Single active dialog**: Only one UI request can be active at a time. If a new request arrives while one is pending, it's logged and ignored. This matches the SDK's request-response model where each `select()`/`confirm()`/`input()` call awaits a response.

3. **No new ChatMessage types**: UI requests and workflow steps are NOT added to the message array. They're tracked as separate state (hooks) and rendered as supplementary rows in the timeline. This avoids polluting the message history with transient UI state.

4. **Global palette sends command immediately**: Unlike the inline `/` palette which replaces the input text, the global Ctrl+Shift+P palette sends the command immediately after selection. This matches VS Code behavior where the command palette is an action trigger, not a text input method.

5. **Workflow step deduplication**: Steps are keyed by `stepIndex` in a Map, so if a step status updates (e.g., running -> completed), the previous entry is replaced rather than duplicated.

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/hooks/useUIRequests.ts` | **New** | UI request state management hook |
| `src/renderer/src/hooks/useWorkflowSteps.ts` | **New** | Workflow step tracking hook |
| `src/renderer/src/components/chat/UIDialog.tsx` | **New** | Select/Confirm/Input dialog components |
| `src/renderer/src/components/chat/WorkflowStepProgress.tsx` | **New** | Workflow step progress renderer |
| `src/renderer/src/components/chat/GlobalCommandPalette.tsx` | **New** | Ctrl+Shift+P command palette |
| `src/renderer/src/components/chat/ChatView.tsx` | **Modified** | Integrated hooks, extended MessageGroup union, added renderRow cases, added global shortcut |
| `src/main/electron-ui-context.ts` | **Modified** | Fixed logger import, removed implements clause, lint fixes |
| `src/main/session-manager.ts` | **Modified** | Added eslint-disable for uiContext cast |
| `src/main/threading/worker-bootstrap.ts` | **Modified** | Removed unused import, added eslint-disable |
| `src/tests/__utils__/test-utils.tsx` | **Modified** | Added uiRespond/onUIRequest mocks |
| `src/tests/shared/ipc-channels.test.ts` | **Modified** | Updated expected channel list |
| `docs/bugs/phase2-ui-protocol-workflow-progress.md` | **New** | This document |

## Phase 3 (Not Implemented)

The following Phase 3 features remain unimplemented:
- Command history (recently used)
- Keyboard shortcuts for common commands
- Workflow builder UI
- Inline command documentation (hover)
- Command suggestion based on context
