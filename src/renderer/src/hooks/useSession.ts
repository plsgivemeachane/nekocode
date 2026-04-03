import { useState, useCallback, useRef, useEffect } from 'react'
import type { SessionStreamEvent } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'

interface SessionState {
  sessionId: string | null
  cwd: string | null
  isStreaming: boolean
  messages: ChatMessage[]
  error: string | null
}

const INITIAL_STATE: SessionState = {
  sessionId: null,
  cwd: null,
  isStreaming: false,
  messages: [],
  error: null,
}

export function useSession() {
  const [state, setState] = useState<SessionState>(INITIAL_STATE)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const handleEvent = useCallback((event: SessionStreamEvent) => {
    switch (event.type) {
      case 'text_delta':
        setState(prev => {
          const messages = [...prev.messages]
          const last = messages[messages.length - 1]
          if (last && last.role === 'assistant' && last.type === 'text' && prev.isStreaming) {
            messages[messages.length - 1] = { ...last, content: last.content + event.delta }
          } else {
            messages.push({ role: 'assistant', type: 'text', content: event.delta, id: generateId() })
          }
          return { ...prev, messages, isStreaming: true, error: null }
        })
        break

      case 'tool_call':
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'assistant',
              type: 'tool_call',
              toolName: event.toolName,
              toolId: generateId(),
              args: event.args,
              status: 'running',
              id: generateId(),
            },
          ],
        }))
        break

      case 'tool_result': {
        setState(prev => {
          const messages = [...prev.messages]
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            if (
              msg.role === 'assistant' &&
              msg.type === 'tool_call' &&
              msg.toolName === event.toolName &&
              msg.status === 'running'
            ) {
              messages[i] = { ...msg, status: 'done', result: event.result, isError: event.isError }
              break
            }
          }
          return { ...prev, messages }
        })
        break
      }

      case 'error':
        setState(prev => ({ ...prev, isStreaming: false, error: event.message }))
        break

      case 'done':
        setState(prev => ({ ...prev, isStreaming: false }))
        break
    }
  }, [])

  const createSession = useCallback(async (): Promise<boolean> => {
    const folder = await window.nekocode.dialog.openFolder()
    if (!folder) return false

    try {
      const { sessionId } = await window.nekocode.session.create(folder)
      setState({ sessionId, cwd: folder, isStreaming: false, messages: [], error: null })

      unsubRef.current?.()
      unsubRef.current = window.nekocode.session.onEvent(handleEvent)
      return true
    } catch (err) {
      setState(prev => ({ ...prev, error: `Failed to create session: ${err}` }))
      return false
    }
  }, [handleEvent])

  const sendPrompt = useCallback(async (text: string): Promise<void> => {
    if (!state.sessionId) return
    const userMsg: ChatMessage = { role: 'user', content: text, id: generateId() }
    setState(prev => ({ ...prev, messages: [...prev.messages, userMsg], error: null }))
    try {
      await window.nekocode.session.prompt(state.sessionId, text)
    } catch (err) {
      setState(prev => ({ ...prev, error: `Prompt failed: ${err}` }))
    }
  }, [state.sessionId])

  const disposeSession = useCallback(async (): Promise<void> => {
    if (!state.sessionId) return
    unsubRef.current?.()
    unsubRef.current = null
    try {
      await window.nekocode.session.dispose(state.sessionId)
    } catch (err) {
      console.error('[session] dispose error:', err)
    }
    setState(INITIAL_STATE)
  }, [state.sessionId])

  return {
    sessionId: state.sessionId,
    cwd: state.cwd,
    isStreaming: state.isStreaming,
    messages: state.messages,
    error: state.error,
    createSession,
    sendPrompt,
    disposeSession,
  }
}
