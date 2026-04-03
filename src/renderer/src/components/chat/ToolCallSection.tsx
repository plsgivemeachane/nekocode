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
      <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
    ) : isError ? (
      <span className="text-red-400" aria-label="error">&#x2717;</span>
    ) : (
      <span className="text-emerald-400" aria-label="done">&#x2713;</span>
    )

  const resultText = result != null ? formatResult(result) : null

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-zinc-500 font-mono text-xs">&#x26A1;</span>
        <span className="text-sm font-mono text-zinc-300 truncate">{toolName}</span>
        {statusIndicator}
        <span className="ml-auto text-xs text-zinc-600">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && resultText && (
        <div className="border-t border-zinc-800">
          <pre className="p-3 text-xs font-mono text-zinc-400 bg-zinc-900 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
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
