import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect, useLayoutEffect } from 'react'
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
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  // Caret coordinates (relative to the textarea content box) for the blocky
  // terminal cursor overlay. null = no visible block cursor (e.g. not focused).
  const [caret, setCaret] = useState<{ x: number; y: number; h: number } | null>(null)

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

  /** Recompute the blocky cursor overlay position by mirroring the textarea's
   *  text into a hidden div with identical typography, then measuring the
   *  caret position. This is the standard "caret mirror" technique — needed
   *  because the native caret is hidden (caret-transparent) and we draw a
   *  solid TUI block instead (OpenCode-style). */
  const updateCaret = useCallback(() => {
    const ta = textareaRef.current
    const mirror = mirrorRef.current
    if (!ta || !mirror) {
      setCaret(null)
      return
    }
    // Only show the block cursor when the textarea is focused and interactive.
    const interactive = !ta.disabled && document.activeElement === ta
    if (!interactive) {
      setCaret(null)
      return
    }
    const pos = ta.selectionStart ?? 0
    // Mirror everything up to the caret. Use a trailing marker span so we can
    // measure its offset — and keep the trailing newline behavior correct.
    const before = ta.value.slice(0, pos)
    mirror.textContent = ''
    const textNode = document.createTextNode(before)
    mirror.appendChild(textNode)
    const marker = document.createElement('span')
    marker.textContent = '\u200b' // zero-width space as a measurable anchor
    mirror.appendChild(marker)
    const mirrorRect = mirror.getBoundingClientRect()
    const markerRect = marker.getBoundingClientRect()
    setCaret({
      x: markerRect.left - mirrorRect.left,
      y: markerRect.top - mirrorRect.top,
      h: markerRect.height || parseFloat(getComputedStyle(ta).lineHeight || '20'),
    })
  }, [])

  // Recompute on input, selection change, focus, and layout changes.
  useLayoutEffect(() => {
    updateCaret()
  }, [input, updateCaret])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const handler = () => updateCaret()
    ta.addEventListener('focus', handler)
    ta.addEventListener('blur', handler)
    ta.addEventListener('keyup', handler)
    ta.addEventListener('click', handler)
    ta.addEventListener('select', handler)
    document.addEventListener('selectionchange', handler)
    return () => {
      ta.removeEventListener('focus', handler)
      ta.removeEventListener('blur', handler)
      ta.removeEventListener('keyup', handler)
      ta.removeEventListener('click', handler)
      ta.removeEventListener('select', handler)
      document.removeEventListener('selectionchange', handler)
    }
  }, [updateCaret])

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

      // ─── Ctrl+C = Stop streaming (OpenCode TUI convention) ────────────
      // When a response is streaming, Ctrl+C aborts it — but ONLY if there
      // is no active text selection, so users can still copy selected text.
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && isStreaming) {
        const ta = e.currentTarget
        const hasSelection = ta.selectionStart !== ta.selectionEnd
        if (!hasSelection) {
          e.preventDefault()
          void abortPrompt()
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        trySend(input, isStreaming, isAgentConnecting, setInput, resetHeight, sendPrompt)
      }
    },
    [input, isStreaming, isAgentConnecting, setInput, resetHeight, sendPrompt, showCommandPalette, abortPrompt],
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

  // Whether the block cursor should blink (focused + interactive + not in
  // a command-palette navigation state).
  const showBlockCursor = caret !== null

  return (
    <footer className="px-6 py-2 bg-terminal-bg">
      <div className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit}>
          <div
            ref={inputContainerRef}
            onMouseDown={handleInputContainerMouseDown}
            // ─── OpenCode TUI styling ──────────────────────────────
            // Sharp rectangle (rounded-none, keeps "rounded" substring so the
            // focus-mousedown test selector [class*=rounded] still matches).
            // Deep-black panel, thin left accent bar in the accent color.
            // No pr-12 anymore — send/stop buttons were removed; stopping is
            // done via Ctrl+C (see handleKeyDown).
            className="relative rounded-none border border-terminal-border border-l-[3px] border-l-accent-500 bg-terminal-panel px-4 py-3 cursor-text"
          >
            {/* Hidden mirror used to measure the caret position for the blocky
                terminal cursor. Must share the EXACT same typography, width,
                padding, and wrapping as the textarea. */}
            <div
              ref={mirrorRef}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 invisible whitespace-pre-wrap break-words font-mono text-sm leading-relaxed"
              style={{
                width: 'calc(100% - 0px)',
                padding: '0px',
                // mirror sits inside the same padded container; offset by the
                // textarea's own padding so coordinates line up.
                transform: 'translate(0px, 0px)',
              }}
            />
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isAgentConnecting ? 'Agent starting, please wait...' : 'Ask anything, @tag files/folders, or type / for commands'}
              disabled={!sessionId || isStreaming || isAgentConnecting}
              rows={1}
              // caret-transparent hides the native thin caret; we draw a solid
              // TUI block instead (OpenCode-style).
              // font-mono is REQUIRED here so the textarea's glyph widths match
              // the hidden mirror div exactly — otherwise the blocky cursor
              // drifts out of alignment as the text wraps.
              className="w-full bg-transparent dark:bg-transparent font-mono text-sm text-text-primary placeholder:text-text-tertiary/50 focus-visible:ring-0 focus-visible:border-transparent border-0 shadow-none rounded-none min-h-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed resize-none overflow-y-auto leading-relaxed field-sizing-none caret-transparent"
            />
            {/* Blocky terminal cursor overlay — drawn on top of the textarea
                at the measured caret position. Blinks via animate-block-blink. */}
            {showBlockCursor && caret && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bg-accent-400 animate-block-blink"
                style={{
                  // caret.x/y are relative to the mirror which is pinned to the
                  // container's top-left. The textarea sits at the container's
                  // padding offset, so add the textarea's padding (px-4 py-3 →
                  // 16px / 12px) to land on the right spot.
                  left: `calc(${caret.x}px + 1rem)`,
                  top: `calc(${caret.y}px + 0.75rem)`,
                  width: '0.6em',
                  height: `${caret.h}px`,
                }}
              />
            )}
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
                      className="w-56 bg-surface-800 border-terminal-border rounded-none shadow-xl p-2 max-h-64 overflow-y-auto"
                    >
                      {(() => {
                        const visibleModels = modelList.filter(m => !["anthropic", "google", "openai"].includes(m.provider))
                        return visibleModels.length > 0 ? visibleModels.map(m => (
                          <button
                            key={`${m.provider}:${m.id}`}
                            type="button"
                            onClick={() => { setModel(m.provider, m.id); setShowModelDropdown(false) }}
                            className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-700 transition-colors flex items-center justify-between rounded-none border border-transparent hover:border-surface-600 ${activeModel?.id === m.id && activeModel?.provider === m.provider ? "text-accent-400" : "text-text-secondary"}`}
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
            {/* Streaming indicator — replaces the old stop button. Stopping is
                done via Ctrl+C (OpenCode TUI convention), surfaced as a hint. */}
            {isStreaming && (
              <div className="absolute right-3 bottom-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-text-tertiary select-none pointer-events-none">
                <span className="relative flex h-[7px] w-[7px] shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-60" />
                  <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-error" />
                </span>
                Ctrl+C to stop
              </div>
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