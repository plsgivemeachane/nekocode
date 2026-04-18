import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'
import { createLogger } from '../logger'

type Model = { id: string; name: string; provider: string }

const logger = createLogger('ChatInput')

const TEXTAREA_MAX_HEIGHT_PX = 200

interface ChatInputProps {
  sessionId: string | null
  isStreaming: boolean
  input: string
  setInput: (value: string) => void
  sendPrompt: (text: string) => Promise<void>
  abortPrompt: () => Promise<void>
  activeModel: Model | null
  modelList: Model[]
  setModel: (provider: string, id: string) => void
  projectPath: string | null
  gitBranch: string | null
}

export interface ChatInputHandle {
  focus: () => void
}

/** Shared "trim → check → clear → reset height → send" logic */
function trySend(
  input: string,
  isStreaming: boolean,
  setInput: (v: string) => void,
  resetHeight: () => void,
  sendPrompt: (text: string) => Promise<void>,
): boolean {
  const text = input.trim()
  if (!text || isStreaming) return false
  setInput('')
  resetHeight()
  logger.info(`submit: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)
  void sendPrompt(text)
  return true
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  sessionId,
  isStreaming,
  input,
  setInput,
  sendPrompt,
  abortPrompt,
  activeModel,
  modelList,
  setModel,
  projectPath,
  gitBranch,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  useImperativeHandle(ref, () => ({
    focus: () => {
      const ta = textareaRef.current
      if (!ta || ta.disabled) return
      ta.focus()
      const length = ta.value.length
      ta.setSelectionRange(length, length)
    },
  }), [])

  useClickOutside(modelDropdownRef, showModelDropdown, () => setShowModelDropdown(false))

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      trySend(input, isStreaming, setInput, resetHeight, sendPrompt)
    },
    [input, isStreaming, setInput, resetHeight, sendPrompt],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        trySend(input, isStreaming, setInput, resetHeight, sendPrompt)
      }
    },
    [input, isStreaming, setInput, resetHeight, sendPrompt],
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
    }
  }, [setInput])

  const handleInputContainerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, a, select, option, [role="button"]')) return
    e.preventDefault()
    textareaRef.current?.focus()
  }, [])

  return (
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
          <span className="flex items-center gap-1.5 text-[11px] text-text-tertiary truncate max-w-[260px]">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 4v8a2 2 0 002 2h8a2 2 0 002-2V4M2 4l2-2h8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {projectPath}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
            {gitBranch ?? "..."}
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </div>
      </div>
    </footer>
  )
})
