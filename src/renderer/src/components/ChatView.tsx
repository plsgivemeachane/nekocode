import React, { useRef, useEffect, useCallback } from 'react'
import { useSession } from '../hooks/useSession'
import { UserMessage } from './chat/UserMessage'
import { AssistantMessage } from './chat/AssistantMessage'
import { ToolCallGroup } from './chat/ToolCallSection'
import { MessagesTimeline } from './chat/MessagesTimeline'
import { StatusIndicator } from './StatusIndicator'
import { WelcomeScreen } from './WelcomeScreen'
import { NavBar } from './NavBar'
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
  const { messages, isHistoryLoading, isStreaming, error, input, setInput, sendPrompt, abortPrompt, activeModel, modelList, setModel, usage, streamStartTime } =
    useSession({ sessionId })

  const [showScrollBtn, setShowScrollBtn] = React.useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showModelDropdown, setShowModelDropdown] = React.useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  const getDistanceFromBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }, [])

  // Instant scroll to bottom (no smooth — avoids jank during streaming)
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current
    if (!el) return
    programmaticScrollRef.current = true
    isAtBottomRef.current = true
    setShowScrollBtn(false)
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    requestAnimationFrame(() => {
      const current = scrollContainerRef.current
      if (current) {
        const atBottom = getDistanceFromBottom(current) < SCROLL_THRESHOLD_PX
        isAtBottomRef.current = atBottom
        setShowScrollBtn(!atBottom && messages.length > 0)
      }
      programmaticScrollRef.current = false
    })
  }, [getDistanceFromBottom, messages.length])

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showModelDropdown])

  // Track scroll position — update isAtBottomRef and button visibility
  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = getDistanceFromBottom(el) < SCROLL_THRESHOLD_PX
    isAtBottomRef.current = atBottom
    setShowScrollBtn(!atBottom && messages.length > 0)
  }, [getDistanceFromBottom, messages.length])

  // Auto-scroll when messages or streaming state change — only if user hasn't scrolled up
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(false)
    }
  }, [messages, isStreaming, scrollToBottom])

  // Keep auto-scroll stable when content height changes after render (e.g. markdown/code highlighting)
  useEffect(() => {
    const container = scrollContainerRef.current
    const content = messageContentRef.current
    if (!container || !content) return

    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        scrollToBottom(false)
      }
    })

    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToBottom])

  // While streaming, keep the viewport locked to bottom unless the user scrolls away.
  useEffect(() => {
    if (!isStreaming) return

    let rafId = 0
    const tick = () => {
      if (isAtBottomRef.current) {
        scrollToBottom(false)
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isStreaming, scrollToBottom])

  // Scroll to bottom on initial session (when first messages arrive)
  useEffect(() => {
    if (messages.length === 1) {
      scrollToBottom(false)
    }
  }, [messages.length, scrollToBottom])

  // Reset scroll lock on session switch so each session opens at latest messages
  useEffect(() => {
    isAtBottomRef.current = true
    setShowScrollBtn(false)
    if (sessionId) {
      requestAnimationFrame(() => scrollToBottom(false))
    }
  }, [sessionId, scrollToBottom])

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

  const handleSuggestionFromWelcome = useCallback((prompt: string) => {
    setInput(prompt)
    sendPrompt(prompt)
  }, [sendPrompt])

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

  const handleInputContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, a, select, option, [role="button"]')) return
    e.preventDefault()
    textareaRef.current?.focus()
  }

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null

  // Group consecutive tool_call messages into clusters
  type ToolCallMsg = Extract<ChatMessage, { role: 'assistant'; type: 'tool_call' }>
  type MessageGroup =
    | { key: string; type: 'single'; msg: ChatMessage }
    | { key: string; type: 'tool-group'; msgs: ToolCallMsg[] }
  const isToolCall = (msg: ChatMessage): msg is ToolCallMsg => msg.role === 'assistant' && msg.type === 'tool_call'
  const messageGroups: MessageGroup[] = []
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
      <NavBar />

      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 pt-8 pb-10 relative"
      >
        <div ref={messageContentRef}>
          {!sessionId ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-full max-w-xl rounded-2xl border border-surface-700/70 bg-surface-900/75 px-8 py-10 shadow-[0_16px_44px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-surface-600 bg-surface-800/70 px-3 py-1.5 text-xs text-text-secondary">
                  <span className="inline-block h-2 w-2 rounded-full bg-accent-400" />
                  Workspace Ready
                </div>

                <h2 className="text-xl font-display font-semibold tracking-tight text-text-primary">
                  Select a session from the sidebar
                </h2>

                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Open an existing conversation or create a new session to start chatting with your project context.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-2.5 text-sm text-text-secondary sm:grid-cols-2">
                  <div className="rounded-lg border border-surface-700/70 bg-surface-800/45 px-3 py-2.5">
                    Resume a previous session
                  </div>
                  <div className="rounded-lg border border-surface-700/70 bg-surface-800/45 px-3 py-2.5">
                    Create a new focused thread
                  </div>
                </div>
              </div>
            </div>
          ) : isHistoryLoading && messages.length === 0 ? (
            <div className="max-w-3xl mx-auto pt-8">
              <div className="rounded-xl border border-surface-700/70 bg-surface-900/60 px-4 py-3 text-sm text-text-secondary">
                Loading session messages...
              </div>
            </div>
          ) : messages.length === 0 ? (
            <WelcomeScreen onSuggestionClick={handleSuggestionFromWelcome} />
          ) : (
            <div className="max-w-3xl mx-auto pt-4">
              <MessagesTimeline
                rows={messageGroups}
                isStreaming={isStreaming}
                scrollContainerRef={scrollContainerRef}
                getRowKey={(group) => group.key}
                renderRow={(group) => {
                  if (group.type === 'tool-group') {
                    return (
                      <ToolCallGroup
                        toolCalls={group.msgs.map((m) => ({
                          id: m.id,
                          toolName: m.toolName,
                          status: m.status,
                          isError: m.isError,
                          args: m.args,
                        }))}
                      />
                    )
                  }
                  return <div>{renderMessage(group.msg)}</div>
                }}
              />
              <StatusIndicator
                isStreaming={isStreaming}
                modelName={activeModel?.name ?? null}
                usage={usage}
                streamStartTime={streamStartTime}
              />
            </div>
          )}
        </div>

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
            <div
              onMouseDown={handleInputContainerMouseDown}
              className="rounded-[1.25rem] border border-surface-700 bg-surface-900 p-4 shadow-[0_0_20px_rgba(0,0,0,0.2)] cursor-text"
            >
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
                  <div ref={modelDropdownRef} className="relative">
                    <button type="button" onClick={() => setShowModelDropdown(v => !v)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-md hover:bg-surface-800 transition-colors duration-150 border border-transparent hover:border-surface-600">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-400">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <span>{activeModel ? activeModel.name : "Loading..."}</span>
                      <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-tertiary"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {showModelDropdown && (() => {
                      const visibleModels = modelList.filter(m => !["anthropic", "google", "openai"].includes(m.provider))
                      return visibleModels.length > 0 ? (
                      <div className="absolute bottom-full left-0 mb-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-xl p-2 max-h-64 overflow-y-auto z-50">
                        {visibleModels.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setModel(m.provider, m.id); setShowModelDropdown(false) }}
                            className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-700 transition-colors flex items-center justify-between rounded-md border border-transparent hover:border-surface-600 ${activeModel?.id === m.id ? "text-accent-400" : "text-text-secondary"}`}
                          >
                            <span>{m.name}</span>
                            <span className="text-text-tertiary text-[10px] ml-2">{m.provider}</span>
                          </button>
                        ))}
                      </div>
                      ) : (
                        <div className="absolute bottom-full left-0 mb-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-xl p-2 z-50">
                          <div className="px-3 py-2 text-xs text-text-tertiary">No models configured</div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => void abortPrompt()}
                    disabled={!sessionId}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-error text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-black/25"
                    aria-label="Stop response"
                    title="Stop"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="3" y="3" width="8" height="8" rx="1.2" fill="currentColor" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!sessionId || !input.trim()}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-accent-700 text-white hover:bg-accent-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-accent-700/25 hover:shadow-accent-600/35"
                    aria-label="Send message"
                    title="Send"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
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
