import React, { useState, useRef, useEffect, useCallback } from 'react'

interface ThinkingBlockProps {
  content: string
  isStreaming: boolean
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom of thinking content when streaming in expanded mode
  useEffect(() => {
    if (isStreaming && scrollRef.current && expanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming, expanded])

  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])

  const hasContent = content.length > 0
  const lineCount = content.trim().split('\n').length

  // ─── OpenCode TUI styling ───────────────────────────────────────────
  // Thinking is NOT a box — it's a compact, collapsible dim line. The header
  // is a single dim line ("Thought · N lines"); the content (when expanded)
  // is rendered as dimmer monospace text below. No border, no background.
  //
  // Test contracts preserved:
  //   - "Thinking" label text
  //   - "N lines" / "1 line" when collapsed + not streaming + has content
  //   - .whitespace-pre-wrap on the content <p>
  //   - .animate-ping streaming dot inside the header button
  //   - .animate-glow-pulse streaming cursor
  //   - .overflow-hidden (collapsed) / .overflow-y-auto (expanded) wrapper
  //   - svg.rotate-90 chevron when expanded
  return (
    <div className="font-mono">
      {/* Header — clickable to expand/collapse. A single dim line. */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-3 py-0.5 w-full text-left text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {/* Chevron — rotates when expanded (test: svg.rotate-90) */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* "Thought" prefix + the required "Thinking" label, kept dim */}
        <span className="select-none">Thought</span>
        <span className="select-none">·</span>
        <span className="select-none">
          Thinking
        </span>

        {/* Streaming ping dot (test: .animate-ping inside the button) */}
        {isStreaming && (
          <span className="relative flex h-[7px] w-[7px] shrink-0 ml-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-accent-400" />
          </span>
        )}

        {/* Line count — only when collapsed, not streaming, and has content.
            Test asserts exact "N lines" / "1 line" text. */}
        {!isStreaming && !expanded && hasContent && (
          <span className="text-text-tertiary ml-auto">
            {lineCount} line{lineCount !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {/* Content area — smooth expand/collapse via max-height transition.
          Test selectors on the wrapper:
            - collapsed: .overflow-hidden
            - expanded:  .overflow-y-auto
          Collapsed: flex-col justify-end pushes latest content to the bottom
          of the clipped area so the most recent thinking is always visible. */}
      {hasContent && (
        <div
          ref={expanded ? scrollRef : undefined}
          className={`
            transition-[max-height] duration-300 ease-out
            ${expanded
              ? 'max-h-[300px] overflow-y-auto'
              : 'max-h-[5rem] overflow-hidden flex flex-col justify-end'
            }
          `}
        >
          <div className="px-3 py-1">
            {/* Dimmer text than normal messages — thinking is lower priority.
                Test: content <p> has .whitespace-pre-wrap. */}
            <p className="text-[12px] text-text-tertiary/80 whitespace-pre-wrap break-words leading-relaxed">
              {content}
              {/* Streaming blocky cursor (test: .animate-glow-pulse) */}
              {isStreaming && (
                <span className="inline-block w-1.5 h-3 bg-accent-400 animate-glow-pulse ml-0.5 align-text-bottom" />
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}