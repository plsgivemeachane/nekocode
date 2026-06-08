import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { useCommands } from '../../hooks/useCommands'
import { CommandPalette } from './CommandPalette'
import { Textarea } from '../ui/textarea'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '../ui/popover'
import type { CommandInfo } from '../../../../shared/ipc-types'
import { createLogger } from '../../utils/logger'

type Model = { id: string; name: string; provider: string }

const logger = createLogger('ChatInput')

const TEXTAREA_MAX_HEIGHT_PX = 200

interface ChatInputProps {
  sessionId: string | null
  isStreaming: boolean
  isAgentConnecting: boolean
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
  isAgentConnecting: boolean,
  setInput: (v: string) => void,
  resetHeight: () => void,
  sendPrompt: (text: string) => Promise<void>,
): boolean {
  const text = input.trim()
  if (!text || isStreaming || isAgentConnecting) return false
  setInput('')
  resetHeight()
  logger.info(`submit: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)
  void sendPrompt(text)
  return true
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  sessionId,
  isStreaming,
  isAgentConnecting,
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
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  // Fetch available commands for the current session
  const { commands, isLoading: commandsLoading, recordCommandUsage, getRecentCommandNames } = useCommands({ sessionId })

  // Compute recent command names set for section splitting in the inline palette
  const recentCommandNames = useMemo(() => getRecentCommandNames(), [getRecentCommandNames, commands])

  useImperativeHandle(ref, () => ({
    focus: () => {
      const ta = textareaRef.current
      if (!ta || ta.disabled) return
      ta.focus()
      const length = ta.value.length
      ta.setSelectionRange(length, length)
    },
  }), [])

  // Click-outside for model dropdown handled by Radix Popover

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [])

  /** Extract the current / command query from the input text.
   *  Slash commands are only valid at the START of the input — "hello /abc"
   *  should NOT trigger a command, only "/abc" should. */
  const getCommandQuery = useCallback((text: string): string => {
    const trimmed = text.trimStart()
    if (trimmed.startsWith('/')) {
      return trimmed.slice(1) // Remove the '/' prefix
    }
    return ''
  }, [])

  /** Handle a command being selected from the palette */
  const handleCommandSelect = useCallback(
    (command: CommandInfo) => {
      // Record command usage for recent-commands tracking
      recordCommandUsage(command.name, command.source)
      // Replace the entire input with the selected command name.
      // Slash commands are start-of-input only, so we replace from the beginning.
      const newInput = `/${command.name} `
      setInput(newInput)
      setShowCommandPalette(false)
      // Focus back on textarea after selection
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    },
    [setInput, recordCommandUsage],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      trySend(input, isStreaming, isAgentConnecting, setInput, resetHeight, sendPrompt)
    },
    [input, isStreaming, isAgentConnecting, setInput, resetHeight, sendPrompt],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // If command palette is open, handle navigation keys
      if (showCommandPalette) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') {
          // Forward keyboard navigation to the cmdk root element.
          // cmdk listens for keydown on its [cmdk-root] container, but since
          // focus stays on this textarea, the events never reach cmdk.
          // We dispatch a synthetic event so cmdk handles navigation natively.
          // Prevent default to avoid cursor movement in textarea while navigating the palette.
          e.preventDefault()
          const cmdkRoot = document.querySelector('[cmdk-root]')
          if (cmdkRoot) {
            const syntheticEvent = new KeyboardEvent('keydown', {
              key: e.key,
              code: e.code,
              bubbles: true,
              cancelable: true,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
              metaKey: e.metaKey,
            })
            cmdkRoot.dispatchEvent(syntheticEvent)
          }
          return
        }
        if (e.key === 'Tab') {
          // Prevent browser default Tab behavior (focus shift to next element)
          // and select the currently highlighted command from the palette.
          // cmdk doesn't natively handle Tab, so we click the selected item directly.
          e.preventDefault()
          const selected = document.querySelector('[cmdk-root] [data-selected="true"]') as HTMLElement | null
          if (selected) {
            selected.click()
          }
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        trySend(input, isStreaming, isAgentConnecting, setInput, resetHeight, sendPrompt)
      }
    },
    [input, isStreaming, isAgentConnecting, setInput, resetHeight, sendPrompt, showCommandPalette],
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
    }

    // Show command palette only when typing '/' at the START of input.
    // Slash commands like "/help" should only trigger at the beginning,
    // NOT in the middle of text like "hello /help".
    const trimmed = value.trimStart()
    if (trimmed.startsWith('/')) {
      setShowCommandPalette(true)
    } else if (showCommandPalette) {
      setShowCommandPalette(false)
    }
  }, [setInput, showCommandPalette])

  const handleInputContainerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, a, select, option, [role="button"]')) return
    e.preventDefault()
    textareaRef.current?.focus()
  }, [])

  return (
    <footer className="px-6 py-2 bg-surface-950">
      <div className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit}>
          <div
            ref={inputContainerRef}
            onMouseDown={handleInputContainerMouseDown}
            className="relative rounded-[1.25rem] border border-surface-700 bg-surface-900 px-4 py-3 pr-12 shadow-[0_0_20px_rgba(0,0,0,0.2)] cursor-text"
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isAgentConnecting ? 'Agent starting, please wait...' : 'Ask anything, @tag files/folders, or type / for commands'}
              disabled={!sessionId || isStreaming || isAgentConnecting}
              rows={1}
              className="w-full bg-transparent dark:bg-transparent text-sm text-text-primary placeholder:text-text-tertiary/50 focus-visible:ring-0 focus-visible:border-transparent border-0 shadow-none rounded-none min-h-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed resize-none overflow-y-auto leading-relaxed field-sizing-none"
            />
            <div className="flex items-center pt-5">
              <div className="flex items-center gap-0 text-xs text-text-secondary">
                <div className="relative">
                  <Popover open={showModelDropdown} onOpenChange={(open) => setShowModelDropdown(open)}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex items-center gap-1.5 px-1.5 py-2 rounded-none transition-colors duration-150 border border-transparent hover:border-surface-600">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-400">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        <span>{activeModel ? activeModel.name : "Loading..."}</span>
                        <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-tertiary"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="top"
                      className="w-56 bg-surface-800 border-surface-700 rounded-lg shadow-xl p-2 max-h-64 overflow-y-auto"
                    >
                      {(() => {
                        const visibleModels = modelList.filter(m => !["anthropic", "google", "openai"].includes(m.provider))
                        return visibleModels.length > 0 ? visibleModels.map(m => (
                          <button
                            key={`${m.provider}:${m.id}`}
                            type="button"
                            onClick={() => { setModel(m.provider, m.id); setShowModelDropdown(false) }}
                            className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-700 transition-colors flex items-center justify-between rounded-md border border-transparent hover:border-surface-600 ${activeModel?.id === m.id && activeModel?.provider === m.provider ? "text-accent-400" : "text-text-secondary"}`}
                          >
                            <span>{m.name}</span>
                            <span className="text-text-tertiary text-[10px] ml-2">{m.provider}</span>
                          </button>
                        )) : (
                          <div className="px-3 py-2 text-xs text-text-tertiary">No models configured</div>
                        )
                      })()}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
            {isStreaming ? (
              <button
                type="button"
                onClick={() => void abortPrompt()}
                disabled={!sessionId}
                className="absolute right-1.5 bottom-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-error text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-black/25"
                aria-label="Stop response"
                title="Stop"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1.2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!sessionId || !input.trim() || isAgentConnecting}
                className="absolute right-1.5 bottom-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-accent-700 text-white hover:bg-accent-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-accent-700/25 hover:shadow-accent-600/35"
                aria-label="Send message"
                title="Send"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </form>

        {/* Command palette popup */}
        <CommandPalette
          commands={commands}
          query={getCommandQuery(input)}
          visible={showCommandPalette}
          isLoading={commandsLoading}
          anchorRect={inputContainerRef.current?.getBoundingClientRect() ?? null}
          onSelect={handleCommandSelect}
          onClose={() => setShowCommandPalette(false)}
          recentCommandNames={recentCommandNames}
        />
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
