import { useState, useCallback, useRef, useEffect } from 'react'
import type { SessionStreamEvent } from '../../../shared/ipc-types'

interface SessionState {
  sessionId: string | null
  cwd: string | null
  isStreaming: boolean
  messages: string[]
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
  }, [])

  const handleEvent = useCallback((event: SessionStreamEvent) => {
    switch (event.type) {
      case 'text_delta':
        setState(prev => {
          const messages = [...prev.messages]
          if (messages.length === 0 || prev.isStreaming === false) {
            messages.push(event.delta)
          } else {
            messages[messages.length - 1] += event.delta
          }
          return { ...prev, messages, isStreaming: true, error: null }
        })
        break

      case 'tool_call':
        console.log(`[tool] execution_start: ${event.toolName}`, event.args)
        break

      case 'tool_result':
        console.log(`[tool] execution_end: ${event.toolName}`, event.isError ? 'ERROR' : 'ok')
        break

      case 'error':
        setState(prev => ({ ...prev, isStreaming: false, error: event.message }))
        break

      case 'done':
        setState(prev => ({ ...prev, isStreaming: false }))
        break
    }
  }, [])

  const sendPrompt = useCallback(async (text: string): Promise<void> => {
    if (!state.sessionId) return
    setState(prev => ({ ...prev, error: null }))
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
