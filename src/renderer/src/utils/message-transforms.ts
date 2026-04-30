import type { ChatMessageIPC, SessionStreamEvent } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'

/** Convert IPC message format to renderer ChatMessage format */
export function ipcToChatMessage(ipc: ChatMessageIPC): ChatMessage[] {
  const msgs: ChatMessage[] = []
  if (ipc.content) {
    if (ipc.role === 'user') {
      msgs.push({ role: 'user', content: ipc.content, id: ipc.id })
    } else {
      msgs.push({ role: 'assistant', type: 'text', content: ipc.content, id: ipc.id })
    }
  }
  if (ipc.toolCalls) {
    for (const tc of ipc.toolCalls) {
      msgs.push({
        role: 'assistant',
        type: 'tool_call',
        toolName: tc.name,
        toolId: tc.id,
        args: tc.args,
        status: 'done',
        result: tc.result,
        isError: tc.isError,
        id: generateId(),
      })
    }
  }
  return msgs
}

/** Convert an array of IPC messages into renderer ChatMessages */
export function ipcToChatMessages(ipcMessages: ChatMessageIPC[]): ChatMessage[] {
  return ipcMessages.flatMap(ipcToChatMessage)
}

/** Produce a stable signature string for a message list (used for stale-detection) */
export function messageSignature(messages: ChatMessage[]): string {
  return messages
    .map((msg) => {
      if (msg.role === 'user') {
        return `u:${msg.content}`
      }
      if (msg.type === 'text') {
        return `a:t:${msg.content}`
      }
      return [
        'a:c',
        msg.toolId,
        msg.toolName,
        msg.status,
        JSON.stringify(msg.args),
        JSON.stringify(msg.result),
        msg.isError ? '1' : '0',
      ].join(':')
    })
    .join('\n')
}

/** Append a text delta to the message list (pure function for text_delta events) */
export function handleTextDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const msgs = [...messages]
  const last = msgs[msgs.length - 1]
  if (last && last.role === 'assistant' && last.type === 'text') {
    msgs[msgs.length - 1] = { ...last, content: last.content + delta }
  } else {
    msgs.push({ role: 'assistant', type: 'text', content: delta, id: generateId() })
  }
  return msgs
}

/** Add a running tool_call message (pure function for tool_call events) */
export function handleToolCall(messages: ChatMessage[], event: SessionStreamEvent & { type: 'tool_call' }): ChatMessage[] {
  return [...messages, {
    role: 'assistant',
    type: 'tool_call',
    toolName: event.toolName,
    toolId: event.toolCallId,
    args: event.args,
    status: 'running',
    id: generateId(),
  }]
}

/** Update a matching running tool_call to done (pure function for tool_result events) */
export function handleToolResult(messages: ChatMessage[], event: SessionStreamEvent & { type: 'tool_result' }): ChatMessage[] {
  const msgs = [...messages]
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (
      msg.role === 'assistant' &&
      msg.type === 'tool_call' &&
      msg.toolId === event.toolCallId &&
      msg.status === 'running'
    ) {
      msgs[i] = { ...msg, status: 'done', result: event.result, isError: event.isError }
      return msgs
    }
  }
  return msgs
}

/** Check whether an error is the "session not found" sentinel */
export function isSessionNotReadyError(err: unknown): boolean {
  if (!err) return false
  const text = typeof err === 'string'
    ? err
    : err instanceof Error
      ? err.message
      : String(err)
  return text.includes('Session not found')
}
