import React from 'react'
import { MarkdownContent } from './MarkdownContent'

interface AssistantMessageProps {
  content: string
  isStreaming: boolean
}

export function AssistantMessage({ content, isStreaming }: AssistantMessageProps) {
  if (isStreaming) {
    return (
      <div className="max-w-[80%] animate-fade-in">
        <p className="text-sm font-mono text-text-primary whitespace-pre-wrap break-words">
          {content}
          <span className="inline-block w-2 h-4 bg-accent-400 animate-glow-pulse ml-0.5 align-text-bottom" />
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-[80%] animate-fade-in">
      <MarkdownContent content={content} />
    </div>
  )
}
