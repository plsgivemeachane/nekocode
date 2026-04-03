import { useState, useCallback, useRef, useEffect } from 'react'
import type { SessionStreamEvent } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'

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
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps -- input is intentionally not a dep; we read it for save, not react to it

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
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              type: 'tool_call',
              toolName: event.toolName,
              toolId: generateId(),
              args: event.args,
              status: 'running',
              id: generateId(),
            },
          ])
          break

        case 'tool_result': {
          setMessages(prev => {
            const msgs = [...prev]
            for (let i = msgs.length - 1; i >= 0; i--) {
              const msg = msgs[i]
              if (
                msg.role === 'assistant' &&
                msg.type === 'tool_call' &&
                msg.toolName === event.toolName &&
                msg.status === 'running'
              ) {
                msgs[i] = { ...msg, status: 'done', result: event.result, isError: event.isError }
                break
              }
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
