import React, { useRef, useEffect, useCallback } from 'react'
import { useSession } from '../hooks/useSession'
import { UserMessage } from './chat/UserMessage'
import { AssistantMessage } from './chat/AssistantMessage'
import { ToolCallGroup } from './chat/ToolCallSection'
import { createLogger } from '../logger'

const logger = createLogger('ChatView')
import type { ChatMessage } from '../types/chat'

const SCROLL_THRESHOLD_PX = 40
const TEXTAREA_MAX_HEIGHT_PX = 200

interface ChatViewProps {
  sessionId: string | null
  className?: string
}

export function ChatView({ sessionId, className }: ChatViewProps) {
  const { messages, isStreaming, error, input, setInput, sendPrompt } =
    useSession({ sessionId })

  const [showScrollBtn, setShowScrollBtn] = React.useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Instant scroll to bottom (no smooth — avoids jank during streaming)
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current
    if (!el) return
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Track scroll position — update isAtBottomRef and button visibility
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX
    isAtBottomRef.current = atBottom
    setShowScrollBtn(!atBottom && messages.length > 0)
  }, [messages.length])

  // Auto-scroll when messages or streaming state change — only if user hasn't scrolled up
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(false)
    }
  }, [messages, isStreaming, scrollToBottom])

  // Scroll to bottom on initial session (when first messages arrive)
  useEffect(() => {
    if (messages.length === 1) {
      scrollToBottom(false)
    }
  }, [messages.length, scrollToBottom])

  // Log session changes
  useEffect(() => {
    if (sessionId) {
      logger.info(`session changed: ${sessionId.slice(0, 8)}...`)
    }
  }, [sessionId])

  // Log errors
  useEffect(() => {
    if (error) {
      logger.warn(`error: ${error}`)
    }
  }, [error])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    // Reset textarea height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    logger.info(`submit: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)
    await sendPrompt(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const text = input.trim()
      if (text && !isStreaming) {
        setInput('')
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
        sendPrompt(text)
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-resize textarea
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
    }
  }

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null

  // Group consecutive tool_call messages into clusters
  type ToolCallMsg = Extract<ChatMessage, { role: 'assistant'; type: 'tool_call' }>
  const isToolCall = (msg: ChatMessage): msg is ToolCallMsg => msg.role === 'assistant' && msg.type === 'tool_call'
  const messageGroups: Array<{ key: string; type: 'single'; msg: ChatMessage } | { key: string; type: 'tool-group'; msgs: ToolCallMsg[] }> = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (isToolCall(msg)) {
      const toolMsgs: ToolCallMsg[] = []
      let current = messages[i]
      while (i < messages.length && isToolCall(current)) {
        toolMsgs.push(current)
        i++
        current = messages[i]
      }
      messageGroups.push({ key: `tg-${toolMsgs[0].id}`, type: 'tool-group', msgs: toolMsgs })
    } else {
      messageGroups.push({ key: msg.id, type: 'single', msg })
      i++
    }
  }
  logger.debug(`messageGroups: ${messageGroups.length} groups (${messageGroups.filter(g => g.type === 'tool-group').length} tool-groups, ${messageGroups.filter(g => g.type === 'single' && g.msg.role === 'assistant' && g.msg.type === 'tool_call').length} orphan tool-calls), total messages: ${messages.length}`)

  const renderMessage = (msg: ChatMessage) => {
    const isLast = msg.id === lastMessageId

    switch (msg.role) {
      case 'user':
        return <UserMessage content={msg.content} />
      case 'assistant':
        if (msg.type === 'text') {
          return (
            <AssistantMessage
              content={msg.content}
              isStreaming={isStreaming && isLast}
            />
          )
        }
        return null
      default:
        return null
    }
  }



  return (
    <div className={`bg-surface-950 text-text-primary flex flex-col h-full ${className ?? ""}`}>
      {/* No header — sidebar has the title */}

      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 relative"
      >
        {!sessionId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-tertiary">Select a session from the sidebar</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-tertiary">Session ready. Type a prompt below.</p>
          </div>
        ) : (
          <div className="space-y-5 max-w-3xl mx-auto">
            {messageGroups.map((group) => {
              if (group.type === 'tool-group') {
                return (
                  <ToolCallGroup
                    key={group.key}
                    toolCalls={group.msgs.map(m => ({
                      id: m.id,
                      toolName: m.toolName,
                      status: m.status,
                      isError: m.isError,
                      args: m.args,
                    }))}
                  />
                )
              }
              return <div key={group.key}>{renderMessage(group.msg)}</div>
            })}
            {isStreaming && (
              <div className="flex items-center gap-2 py-1">
                <span className="sr-only">Agent is working</span>
                <span className="text-sm text-text-tertiary animate-pulse">thinking...</span>
              </div>
            )}
          </div>
        )}

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => scrollToBottom(true)}
            className="fixed bottom-24 right-8 w-9 h-9 flex items-center justify-center bg-surface-800 hover:bg-surface-700 text-text-secondary rounded-full shadow-lg shadow-surface-950/50 border border-surface-700 transition-all duration-200 opacity-0 translate-y-2 animate-slide-up"
            aria-label="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </main>

      {error && (
        <div className="px-6 py-2 bg-error-surface border-t border-error/30 text-error text-sm">
          {error}
        </div>
      )}

      <footer className="px-6 py-4 bg-surface-950">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit}>
            <div className="rounded-[1.25rem] border border-accent-500/70 bg-surface-900 p-4 shadow-[0_0_30px_oklch(0.75_0.15_195/0.06)]">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything, @tag files/folders, or use / to show available commands"
                disabled={!sessionId || isStreaming}
                rows={1}
                className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary/50 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed resize-none overflow-hidden leading-relaxed"
              />
              <div className="flex items-center justify-between mt-2 pt-2">
                <div className="flex items-center gap-0 text-xs text-text-secondary">
                  <button type="button" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface-800 transition-colors duration-150">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-400">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <span>GPT-5.4</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-tertiary"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <div className="w-px h-3.5 bg-surface-700/60 mx-1" />
                  <button type="button" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface-800 transition-colors duration-150">
                    <span>High</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-tertiary"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <div className="w-px h-3.5 bg-surface-700/60 mx-1" />
                  <button type="button" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface-800 transition-colors duration-150">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-text-secondary">
                      <rect x="5" y="7" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M12 7V5M8 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <span>Chat</span>
                  </button>
                  <div className="w-px h-3.5 bg-surface-700/60 mx-1" />
                  <button type="button" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface-800 transition-colors duration-150">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-text-secondary">
                      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <span>Full access</span>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!sessionId || isStreaming || !input.trim()}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-accent-700 text-white hover:bg-accent-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-accent-700/25 hover:shadow-accent-600/35"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </form>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 4v8a2 2 0 002 2h8a2 2 0 002-2V4M2 4l2-2h8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Local
            </span>
            <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
              main
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
          </div>
        </div>
      </footer>

    </div>
  )
}
