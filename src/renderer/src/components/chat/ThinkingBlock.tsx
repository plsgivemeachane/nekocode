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

  return (
    <div className="rounded-lg border border-surface-800/80 bg-surface-900/50 overflow-hidden">
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 px-3 py-[5px] border-b border-surface-800/60 bg-surface-900/70 w-full text-left hover:bg-surface-800/40 transition-colors"
      >
        {/* Chevron */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          className={`text-text-muted transition-transform duration-200 shrink-0 ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Brain icon */}
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-text-muted shrink-0">
          <path d="M8 1C6.5 1 5 2 5 3.5C5 3.5 4 3.5 3.5 4.5C3 5.5 3 7 4 8C3 8.5 2.5 9.5 3 10.5C3.5 11.5 4.5 12 5.5 12C5.5 12 5.5 13 6.5 13.5C7 13.8 7.5 14 8 14C8.5 14 9 13.8 9.5 13.5C10.5 13 10.5 12 10.5 12C11.5 12 12.5 11.5 13 10.5C13.5 9.5 13 8.5 12 8C13 7 13 5.5 12.5 4.5C12 3.5 11 3.5 11 3.5C11 2 9.5 1 8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M8 1V14" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        </svg>

        <span className="text-[12px] font-mono text-text-secondary">
          Thinking
        </span>

        {isStreaming && (
          <span className="relative flex h-[7px] w-[7px] shrink-0 ml-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-accent-400" />
          </span>
        )}

        {!isStreaming && !expanded && hasContent && (
          <span className="text-[11px] font-mono text-text-muted ml-auto">
            {lineCount} line{lineCount !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {/* Content area — smooth expand/collapse via max-height transition.
          Collapsed: flex-col justify-end pushes latest content to the bottom
          of the clipped area so the most recent thinking is always visible.
          Expanded: normal flow with scroll. */}
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
          <div className="relative px-3 py-2">
            <p className="text-[12px] font-mono text-text-tertiary whitespace-pre-wrap break-words leading-relaxed">
              {content}
              {isStreaming && (
                <span className="inline-block w-1.5 h-3 bg-accent-400 animate-glow-pulse ml-0.5 align-text-bottom" />
              )}
            </p>
            {/* Fade overlay when streaming */}
            {isStreaming && !expanded && (
              <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-t from-surface-900/50 to-transparent pointer-events-none" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
