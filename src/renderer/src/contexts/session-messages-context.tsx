/**
 * SessionMessagesContext — lightweight context for sharing the active session's
 * messages between ChatView (producer) and RightSidebar (consumer).
 *
 * ChatView updates this context whenever messages change.
 * RightSidebar reads from it to build diff entries.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from "react"
import type { ChatMessage } from "../types/chat"

interface SessionMessagesAPI {
  /** Current messages for the active session */
  messages: ChatMessage[]
  /** Update the messages (called by ChatView) */
  setMessages: (messages: ChatMessage[]) => void
  /** Notify that a tool call was clicked — opens the right sidebar */
  onToolCallClick: (toolCallId: string) => void
  /** Register a handler for tool call clicks (called by RightSidebar) */
  registerToolCallClickHandler: (handler: (toolCallId: string) => void) => void
}

const SessionMessagesContext = createContext<SessionMessagesAPI | null>(null)

export function SessionMessagesProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessagesState] = useState<ChatMessage[]>([])
  const toolCallClickHandlerRef = useRef<((toolCallId: string) => void) | null>(null)

  const setMessages = useCallback((msgs: ChatMessage[]) => {
    setMessagesState(msgs)
  }, [])

  const onToolCallClick = useCallback((toolCallId: string) => {
    // Forward to whoever registered (RightSidebar -> opens the panel)
    toolCallClickHandlerRef.current?.(toolCallId)
  }, [])

  const registerToolCallClickHandler = useCallback((handler: (toolCallId: string) => void) => {
    toolCallClickHandlerRef.current = handler
  }, [])

  const api: SessionMessagesAPI = {
    messages,
    setMessages,
    onToolCallClick,
    registerToolCallClickHandler,
  }

  return (
    <SessionMessagesContext.Provider value={api}>
      {children}
    </SessionMessagesContext.Provider>
  )
}

export function useSessionMessages() {
  const ctx = useContext(SessionMessagesContext)
  if (!ctx) throw new Error("useSessionMessages must be used within SessionMessagesProvider")
  return ctx
}
