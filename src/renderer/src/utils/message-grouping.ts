/**
 * Message grouping utilities for ChatView.
 *
 * This module extracts the message grouping logic from ChatView into
 * a reusable, testable pure function. The grouping algorithm:
 *
 * 1. Consecutive tool_call messages are grouped into a 'tool-group'
 * 2. Consecutive thinking messages are grouped into a 'thinking-group'
 * 3. All other messages remain as 'single' entries
 *
 * This replaces the inline grouping logic that was previously embedded
 * in the ChatView component's render function, making it:
 * - Testable in isolation
 * - Reusable across components
 * - Easier to extend with new group types
 */

import type {
  ChatMessage,
  AssistantToolCallMessage,
  AssistantThinkingMessage,
} from '../types/chat'
import {
  isAssistantToolCallMessage as isToolCallGuard,
  isAssistantThinkingMessage as isThinkingGuard,
} from '../types/chat'

// ── Type aliases for clarity ──

/** A tool_call assistant message */
export type ToolCallMsg = AssistantToolCallMessage

/** A thinking assistant message */
export type ThinkingMsg = AssistantThinkingMessage

/** Re-export type guards for convenience */
export { isAssistantToolCallMessage as isToolCall, isAssistantThinkingMessage as isThinking } from '../types/chat'

// ── Message group types ──

/** A single message (user or assistant text) */
export interface SingleGroup {
  key: string
  type: 'single'
  msg: ChatMessage
}

/** A group of consecutive tool_call messages */
export interface ToolGroup {
  key: string
  type: 'tool-group'
  msgs: ToolCallMsg[]
}

/** A group of consecutive thinking messages */
export interface ThinkingGroup {
  key: string
  type: 'thinking-group'
  msgs: ThinkingMsg[]
}

/** A UI dialog entry (for active ask_user requests) */
export interface UIDialogGroup {
  key: string
  type: 'ui-dialog'
}

/** A workflow step entry (for active workflow tracking) */
export interface WorkflowStepGroup {
  key: string
  type: 'workflow-step'
  workflowId: string
}

/** Union type for all possible message groups */
export type MessageGroup =
  | SingleGroup
  | ToolGroup
  | ThinkingGroup
  | UIDialogGroup
  | WorkflowStepGroup

// ── Grouping function ──

/**
 * Group messages for timeline rendering.
 *
 * Consecutive tool_call messages are collapsed into a single 'tool-group',
 * consecutive thinking messages into a 'thinking-group', and all other
 * messages remain as 'single' entries.
 *
 * This is a pure function with no side effects — ideal for unit testing.
 *
 * @param messages - Flat array of chat messages to group
 * @returns Array of message groups for timeline rendering
 */
export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]

    if (isToolCallGuard(msg)) {
      const toolMsgs: ToolCallMsg[] = []
      let current = messages[i]
      while (i < messages.length && isToolCallGuard(current)) {
        toolMsgs.push(current)
        i++
        current = messages[i]
      }
      groups.push({ key: `tg-${toolMsgs[0].id}`, type: 'tool-group', msgs: toolMsgs })
    } else if (isThinkingGuard(msg)) {
      const thinkingMsgs: ThinkingMsg[] = []
      let current = messages[i]
      while (i < messages.length && isThinkingGuard(current)) {
        thinkingMsgs.push(current)
        i++
        current = messages[i]
      }
      groups.push({ key: `th-${thinkingMsgs[0].id}`, type: 'thinking-group', msgs: thinkingMsgs })
    } else {
      // Single message (user, assistant text, etc.)
      groups.push({ key: msg.id, type: 'single', msg })
      i++
    }
  }

  return groups
}
