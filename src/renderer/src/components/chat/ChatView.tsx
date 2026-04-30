import React, { useRef, useEffect, useCallback } from 'react'
import { useSession } from '../../hooks/useSession'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ToolCallGroup } from './ToolCallSection'
import { MessagesTimeline } from './MessagesTimeline'
import { StatusIndicator } from '../layout/StatusIndicator'
import { WelcomeScreen } from '../ui/WelcomeScreen'
import { NavBar } from '../layout/NavBar'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { useProjectStore } from '../../stores/project-store'
import { createLogger } from '../../utils/logger'

const logger = createLogger('ChatView')
import type { ChatMessage } from '../../types/chat'

const SESSION_SELECTED_EVENT = 'nekocode:session-selected'

interface ChatViewProps {
  sessionId: string | null
  className?: string
}

export function ChatView({ sessionId, className }: ChatViewProps) {
  const { state: projectState } = useProjectStore()
  const { messages, isHistoryLoading, isStreaming, error, input, setInput, sendPrompt, abortPrompt, activeModel, modelList, setModel, usage, streamStartTime } =
    useSession({ sessionId })
  const isAgentConnecting = sessionId != null && !projectState.agentReady

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<ChatInputHandle>(null)
  const [gitBranch, setGitBranch] = React.useState<string | null>(null)

  // --- Auto-scroll ---
  const { showScrollBtn, scrollToBottom, handleScroll } = useAutoScroll({
    scrollContainerRef,
    messageContentRef,
    scrollDeps: [messages],
    isStreaming,
    sessionId,
    isAgentConnecting,
    isHistoryLoading,
    messageCount: messages.length,
  })

  // --- Focus management ---
  const focusInput = useCallback(() => {
    chatInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!sessionId) return
    requestAnimationFrame(() => {
      focusInput()
    })
  }, [focusInput, sessionId])

  useEffect(() => {
    const handleSessionSelected = () => {
      requestAnimationFrame(() => {
        focusInput()
      })
    }
    window.addEventListener(SESSION_SELECTED_EVENT, handleSessionSelected)
    return () => {
      window.removeEventListener(SESSION_SELECTED_EVENT, handleSessionSelected)
    }
  }, [focusInput])

  // --- Git branch ---
  React.useEffect(() => {
    const path = projectState.activeProjectPath
    if (!path) {
      setGitBranch(null)
      return
    }
    let cancelled = false
    window.nekocode.git.getBranch(path).then((branch) => {
      if (!cancelled) setGitBranch(branch)
    })
    return () => { cancelled = true }
  }, [projectState.activeProjectPath])

  // --- Logging ---
  useEffect(() => {
    if (sessionId) {
      logger.info(`session changed: ${sessionId.slice(0, 8)}...`)
    }
  }, [sessionId])

  useEffect(() => {
    if (error) {
      logger.warn(`error: ${error}`)
    }
  }, [error])

  // --- Welcome screen suggestion handler ---
  const handleSuggestionFromWelcome = useCallback((prompt: string) => {
    setInput(prompt)
    sendPrompt(prompt)
  }, [sendPrompt])

  // --- Message grouping ---
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null

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
        <div ref={messageContentRef} className="min-h-full">
          {!sessionId ? (
            <div className="flex flex-col items-center justify-center h-full select-none pt-16">
              {/* Logo */}
              <div className="relative mb-6">
                <div className="w-14 h-14 rounded-xl bg-surface-900/80 border border-surface-700/50 flex items-center justify-center overflow-hidden">
                  <img
                    src="./favicon.png"
                    alt="nekocode"
                    className="w-10 h-10 object-contain"
                  />
                </div>
              </div>

              {/* Title */}
              <h1 className="text-text-primary text-lg font-semibold tracking-tight mb-1.5 font-mono">
                nekocode
              </h1>
              <p className="text-[#9CA3AF] text-sm mb-12">
                Select a session to continue.
              </p>

              {/* Action chips */}
              <div className="grid grid-cols-2 gap-2.5 max-w-md w-full px-4">
                <div className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-900/80 border border-surface-800 text-left">
                  <span className="text-[#9CA3AF] shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  </span>
                  <span className="text-[#B0B8C4] text-sm">Resume a session</span>
                </div>
                <div className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-900/80 border border-surface-800 text-left">
                  <span className="text-[#9CA3AF] shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                  </span>
                  <span className="text-[#B0B8C4] text-sm">Start a new thread</span>
                </div>
              </div>

              {/* Keyboard shortcuts */}
              <div className="flex items-center gap-5 text-[#9CA3AF] mt-12">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[11px] leading-none font-mono text-[#C9CED6] bg-surface-800/80 border border-surface-600/50 rounded-md">Ctrl</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[11px] leading-none font-mono text-[#C9CED6] bg-surface-800/80 border border-surface-600/50 rounded-md">K</kbd>
                  </div>
                  <span className="text-xs">New session</span>
                </div>
                <span className="text-[#3B3F48] mx-1.5">|</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[11px] leading-none font-mono text-[#C9CED6] bg-surface-800/80 border border-surface-600/50 rounded-md">&uarr;</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[11px] leading-none font-mono text-[#C9CED6] bg-surface-800/80 border border-surface-600/50 rounded-md">&darr;</kbd>
                  </div>
                  <span className="text-xs">Navigate</span>
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
                isAgentConnecting={isAgentConnecting}
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

      <ChatInput
        ref={chatInputRef}
        sessionId={sessionId}
        isStreaming={isStreaming}
        input={input}
        setInput={setInput}
        sendPrompt={sendPrompt}
        abortPrompt={abortPrompt}
        activeModel={activeModel}
        modelList={modelList}
        setModel={setModel}
        projectPath={projectState.activeProjectPath}
        gitBranch={gitBranch}
      />
    </div>
  )
}
