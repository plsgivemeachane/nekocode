import type { MessageUsage } from '../../../shared/ipc-types'

export type ChatMessage =
  | { role: 'user'; content: string; id: string }
  | { role: 'assistant'; type: 'text'; content: string; id: string; usage?: MessageUsage }
  | { role: 'assistant'; type: 'tool_call'; toolName: string; toolId: string; args: unknown; status: 'running' | 'done'; result?: unknown; isError?: boolean; id: string }
  | { role: 'assistant'; type: 'thinking'; content: string; id: string }

// Extracted types for type guards
export type UserMessage = Extract<ChatMessage, { role: 'user' }>
export type AssistantTextMessage = Extract<ChatMessage, { role: 'assistant'; type: 'text' }>
export type AssistantToolCallMessage = Extract<ChatMessage, { role: 'assistant'; type: 'tool_call' }>
export type AssistantThinkingMessage = Extract<ChatMessage, { role: 'assistant'; type: 'thinking' }>

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

export function isAssistantThinkingMessage(msg: ChatMessage): msg is AssistantThinkingMessage {
  return msg.role === 'assistant' && msg.type === 'thinking'
}

let counter = 0

export function generateId(): string {
  counter++
  return `msg-${counter}-${Date.now()}`
}
