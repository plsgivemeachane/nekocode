import type { MessageUsage } from '../../../shared/ipc-types'

export type ChatMessage =
  | { role: 'user'; content: string; id: string }
  | { role: 'assistant'; type: 'text'; content: string; id: string; usage?: MessageUsage }
  | { role: 'assistant'; type: 'tool_call'; toolName: string; toolId: string; args: unknown; status: 'running' | 'done'; result?: unknown; isError?: boolean; id: string }

// Extracted types for type guards
export type UserMessage = Extract<ChatMessage, { role: 'user' }>
export type AssistantTextMessage = Extract<ChatMessage, { role: 'assistant'; type: 'text' }>
export type AssistantToolCallMessage = Extract<ChatMessage, { role: 'assistant'; type: 'tool_call' }>

// Type guards
export function isUserMessage(msg: ChatMessage): msg is UserMessage {
  return msg.role === 'user'
}

export function isAssistantTextMessage(msg: ChatMessage): msg is AssistantTextMessage {
  return msg.role === 'assistant' && msg.type === 'text'
}

export function isAssistantToolCallMessage(msg: ChatMessage): msg is AssistantToolCallMessage {
  return msg.role === 'assistant' && msg.type === 'tool_call'
}

let counter = 0

export function generateId(): string {
  counter++
  return `msg-${counter}-${Date.now()}`
}
