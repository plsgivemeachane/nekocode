# Bug: Chat input not disabled during agent starting/connecting

**Date:** 2026-05-29
**Severity:** Medium (UX annoyance, non-crashing)
**Status:** Fixed

## Description

When an agent session is selected and messages are loaded, but the agent backend is still starting up (connecting), the chat input textarea and send button remain fully enabled. The user can type a message and click send, which causes an error because the agent is not ready to receive prompts yet. This doesn't crash the app, but it's an annoying UX issue.

## Root Cause

The `ChatInput` component only checked two conditions for disabling the textarea and send button:
1. No active session (`!sessionId`)
2. Currently streaming (`isStreaming`)

The `ChatView` component already computed an `isAgentConnecting` variable (`sessionId != null && !projectState.agentReady`) and used it for the `StatusIndicator` (which shows "Connecting..." spinner), but this state was **never passed** to the `ChatInput` component.

## Fix

### Files Changed

1. **`src/renderer/src/components/chat/ChatInput.tsx`**
   - Added `isAgentConnecting: boolean` to `ChatInputProps` interface
   - Added `isAgentConnecting` parameter to the `trySend()` helper function (guard: `if (!text || isStreaming || isAgentConnecting) return false`)
   - Added `isAgentConnecting` to destructured props in the component
   - Updated `handleSubmit` and `handleKeyDown` callbacks to pass `isAgentConnecting` to `trySend()`
   - Added `isAgentConnecting` to textarea `disabled` prop: `disabled={!sessionId || isStreaming || isAgentConnecting}`
   - Added `isAgentConnecting` to send button `disabled` prop: `disabled={!sessionId || !input.trim() || isAgentConnecting}`
   - Updated placeholder text to show "Agent starting, please wait..." when `isAgentConnecting` is true

2. **`src/renderer/src/components/chat/ChatView.tsx`**
   - Passed `isAgentConnecting={isAgentConnecting}` prop to `<ChatInput />`

3. **`src/tests/renderer/ChatInput.test.tsx`**
   - Added `isAgentConnecting: false` to `defaultProps`
   - Added 3 new test cases:
     - "disables textarea when agent is connecting"
     - "disables send button when agent is connecting"
     - "shows connecting placeholder when agent is connecting"

## How to Verify

1. Open NekoCode and select a project/session
2. While the status indicator shows "Connecting", observe that:
   - The textarea is disabled (greyed out, cursor-not-allowed)
   - The placeholder text reads "Agent starting, please wait..."
   - The send button is disabled
   - Pressing Enter does not attempt to send
3. Once the agent is ready and status shows "Ready", the input becomes fully interactive
