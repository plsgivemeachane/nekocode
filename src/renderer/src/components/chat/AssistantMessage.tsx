import { MarkdownContent } from './MarkdownContent'

interface AssistantMessageProps {
  content: string
  isStreaming: boolean
}

export function AssistantMessage({ content, isStreaming }: AssistantMessageProps) {
  if (isStreaming) {
    return (
      <div className="max-w-[80%]">
        <p className="text-sm font-mono text-zinc-300 whitespace-pre-wrap break-words">
          {content}
          <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5 align-text-bottom" />
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-[80%]">
      <MarkdownContent content={content} />
    </div>
  )
}
