export type ChatMessage =
  | { role: 'user'; content: string; id: string }
  | { role: 'assistant'; type: 'text'; content: string; id: string }
  | { role: 'assistant'; type: 'tool_call'; toolName: string; toolId: string; args: unknown; status: 'running' | 'done'; result?: unknown; isError?: boolean; id: string }

let counter = 0

export function generateId(): string {
  counter++
  return `msg-${counter}-${Date.now()}`
}
