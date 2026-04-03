import React, { useRef, useEffect, useCallback } from 'react'
import { useSession } from '../hooks/useSession'
import { UserMessage } from './chat/UserMessage'
import { AssistantMessage } from './chat/AssistantMessage'
import { ToolCallSection } from './chat/ToolCallSection'
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

  // Auto-scroll when messages change — only if user hasn't scrolled up
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(false)
    }
  }, [messages, scrollToBottom])

  // Scroll to bottom on initial session (when first messages arrive)
  useEffect(() => {
    if (messages.length === 1) {
      scrollToBottom(false)
    }
  }, [messages.length, scrollToBottom])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    // Reset textarea height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
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
        if (msg.type === 'tool_call') {
          return (
            <ToolCallSection
              toolName={msg.toolName}
              status={msg.status}
              result={msg.result}
              isError={msg.isError}
            />
          )
        }
        return null
      default:
        return null
    }
  }

  return (
    <div className={`bg-zinc-950 text-zinc-100 flex flex-col h-full ${className ?? ""}`}>
      {/* No header — sidebar has the title */}

      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 relative"
      >
        {!sessionId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500">Select a session from the sidebar</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500">Session ready. Type a prompt below.</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg) => (
              <div key={msg.id}>{renderMessage(msg)}</div>
            ))}
          </div>
        )}

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => scrollToBottom(true)}
            className="fixed bottom-24 right-8 w-9 h-9 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full shadow-lg border border-zinc-700 transition-all duration-200 opacity-0 translate-y-2 animate-[fadeInUp_0.2s_ease_forwards]"
            aria-label="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </main>

      {error && (
        <div className="px-6 py-2 bg-red-950/50 border-t border-red-900 text-red-400 text-sm">
          {error}
        </div>
      )}

      <footer className="border-t border-zinc-800 px-6 py-3">
        <form onSubmit={handleSubmit} className="flex gap-3 max-w-3xl mx-auto items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={sessionId ? 'Type a prompt...' : 'Select a session first'}
            disabled={!sessionId || isStreaming}
            rows={1}
            className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
          />
          <button
            type="submit"
            disabled={!sessionId || isStreaming || !input.trim()}
            className="px-4 py-2 text-sm bg-zinc-100 text-zinc-900 font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </form>
      </footer>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(0.5rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
