import { useState, useCallback, useRef, useEffect } from 'react'
import type { SessionStreamEvent, ChatMessageIPC } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'

/** Convert IPC message format to renderer ChatMessage format */
function ipcToChatMessage(ipc: ChatMessageIPC): ChatMessage[] {
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
function ipcToChatMessages(ipcMessages: ChatMessageIPC[]): ChatMessage[] {
  return ipcMessages.flatMap(ipcToChatMessage)
}

interface UseSessionInput {
  sessionId: string | null
}

interface UseSessionOutput {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
  input: string
  setInput: (text: string) => void
  sendPrompt: (text: string) => Promise<void>
}

const INITIAL_MESSAGES: ChatMessage[] = []

/**
 * Pure session viewer driven by an external sessionId.
 * Subscribes to global events and filters by sessionId.
 * Manages its own message state and input draft per session.
 */
export function useSession({ sessionId }: UseSessionInput): UseSessionOutput {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')

  // Draft preservation: save input text when switching away, restore when switching back
  const drafts = useRef<Map<string, string>>(new Map())

  // Save draft and reset on sessionId change
  useEffect(() => {
    // Save current input under the *previous* sessionId (captured via cleanup)
    return () => {
      // This runs before the next effect with the new sessionId
    }
  }, [sessionId])

  // Handle draft save/restore around sessionId changes
  const prevSessionRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevSessionRef.current

    // Save draft for previous session
    if (prev !== null) {
      drafts.current.set(prev, input)
    }

    // Reset state for new session
    setMessages(INITIAL_MESSAGES)
    setIsStreaming(false)
    setError(null)

    // Restore draft for new session
    const draft = sessionId !== null ? drafts.current.get(sessionId) : null
    setInput(draft ?? '')

    prevSessionRef.current = sessionId
  }, [sessionId])

  // Load message history from main process on mount / sessionId change
  // This enables session persistence: reconnecting to an existing session
  // loads its prior messages instead of starting empty.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    window.nekocode.session.loadHistory(sessionId).then((ipcMessages) => {
      if (cancelled) return
      if (ipcMessages.length > 0) {
        setMessages(ipcToChatMessages(ipcMessages))
      }
    }).catch((err) => {
      if (!cancelled) {
        console.warn('[useSession] failed to load history:', err)
      }
    })
    return () => { cancelled = true }
  }, [sessionId])

  // Subscribe to global session events, filter by our sessionId
  useEffect(() => {
    if (!sessionId) return

    const unsub = window.nekocode.session.onEvent((payload) => {
      if (payload.sessionId !== sessionId) return

      const event: SessionStreamEvent = payload.event

      switch (event.type) {
        case 'text_delta':
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant' && last.type === 'text') {
              msgs[msgs.length - 1] = { ...last, content: last.content + event.delta }
            } else {
              msgs.push({ role: 'assistant', type: 'text', content: event.delta, id: generateId() })
            }
            return msgs
          })
          setIsStreaming(true)
          setError(null)
          break

        case 'tool_call':
          console.log(`[useSession] tool_call event: name=${event.toolName}, id=${event.toolCallId}`)
          setMessages(prev => {
            const newMsg = {
              role: 'assistant' as const,
              type: 'tool_call' as const,
              toolName: event.toolName,
              toolId: event.toolCallId,
              args: event.args,
              status: 'running' as const,
              id: generateId(),
            }
            console.log(`[useSession] adding tool_call message, prev length=${prev.length}, new length=${prev.length + 1}`)
            return [...prev, newMsg]
          })
          break

        case 'tool_result': {
          console.log(`[useSession] tool_result event: name=${event.toolName}, id=${event.toolCallId}, isError=${event.isError}`)
          setMessages(prev => {
            const msgs = [...prev]
            let matched = false
            for (let i = msgs.length - 1; i >= 0; i--) {
              const msg = msgs[i]
              if (
                msg.role === 'assistant' &&
                msg.type === 'tool_call' &&
                msg.toolId === event.toolCallId &&
                msg.status === 'running'
              ) {
                msgs[i] = { ...msg, status: 'done', result: event.result, isError: event.isError }
                matched = true
                console.log(`[useSession] matched tool_result to msg at index ${i}`)
                break
              }
            }
            if (!matched) {
              console.warn(`[useSession] tool_result NO MATCH: id=${event.toolCallId}, name=${event.toolName}. Running tool_calls:`, msgs.filter((m): m is Extract<ChatMessage, { type: 'tool_call' }> => m.role === 'assistant' && m.type === 'tool_call' && m.status === 'running').map(m => ({ id: m.toolId, name: m.toolName })))
            }
            return msgs
          })
          break
        }

        case 'error':
          setIsStreaming(false)
          setError(event.message)
          break

        case 'done':
          setIsStreaming(false)
          break
      }
    })

    return () => {
      unsub()
    }
  }, [sessionId])

  const sendPrompt = useCallback(
    async (text: string): Promise<void> => {
      if (!sessionId) return
      const userMsg: ChatMessage = { role: 'user', content: text, id: generateId() }
      setMessages(prev => [...prev, userMsg])
      setError(null)
      try {
        await window.nekocode.session.prompt(sessionId, text)
      } catch (err) {
        setError(`Prompt failed: ${err}`)
      }
    },
    [sessionId],
  )

  return { messages, isStreaming, error, input, setInput, sendPrompt }
}
