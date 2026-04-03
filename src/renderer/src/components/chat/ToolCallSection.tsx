import { useState, useCallback } from 'react'

interface ToolCallSectionProps {
  toolName: string
  status: 'running' | 'done'
  result?: unknown
  isError?: boolean
}

export function ToolCallSection({ toolName, status, result, isError }: ToolCallSectionProps) {
  const [expanded, setExpanded] = useState(false)

  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])

  const statusIndicator =
    status === 'running' ? (
      <span className="inline-block w-3 h-3 border-2 border-surface-600 border-t-accent-400 rounded-full animate-spin" />
    ) : isError ? (
      <span className="text-error" aria-label="error">&#x2717;</span>
    ) : (
      <span className="text-success" aria-label="done">&#x2713;</span>
    )

  const resultText = result != null ? formatResult(result) : null

  return (
    <div className="rounded-lg border border-surface-800 overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-800/50 transition-colors duration-200"
        aria-expanded={expanded}
      >
        <span className="text-accent-500 font-mono text-xs">&#x26A1;</span>
        <span className="text-sm font-mono text-text-primary truncate">{toolName}</span>
        {statusIndicator}
        <span className="ml-auto text-xs text-text-tertiary">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && resultText && (
        <div className="border-t border-surface-800">
          <pre className="p-3 text-xs font-mono text-text-secondary bg-surface-900 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
            {resultText}
          </pre>
        </div>
      )}
    </div>
  )
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
