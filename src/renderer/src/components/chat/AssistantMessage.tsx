import React, { useState, useCallback } from 'react'
import { MarkdownContent } from './MarkdownContent'

interface AssistantMessageProps {
  content: string
  isStreaming: boolean
}

export function AssistantMessage({ content, isStreaming }: AssistantMessageProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }, [content])

  if (isStreaming) {
    return (
      <div className="max-w-[80%]">
        <p className="text-sm font-mono text-text-primary whitespace-pre-wrap break-words">
          {content}
          <span className="inline-block w-2 h-4 bg-accent-400 animate-glow-pulse ml-0.5 align-text-bottom" />
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-[80%]">
      <MarkdownContent content={content} />
      <button
        onClick={handleCopy}
        className="mt-1 flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        aria-label={copied ? 'Copied' : 'Copy message'}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
