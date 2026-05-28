/**
 * DiffViewer — Renders a unified diff patch with syntax highlighting.
 * Phase 1 uses a simple pre-formatted text view.
 * Phase 4 can upgrade to Monaco diff editor integration.
 *
 * Follows design from docs/features/github-interaction.md.
 */

import React, { useMemo } from 'react'
import type { GitDiffResult } from '../../../../shared/ipc-types'

// ━━ Props ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DiffViewerProps {
  /** Diff result to display */
  diff: GitDiffResult | null
  /** Whether the diff is loading */
  isLoading: boolean
  /** Title for the diff (usually the file path) */
  title?: string
}

// ━━ Diff line classification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type LineType = 'header' | 'hunk' | 'add' | 'remove' | 'context'

interface DiffLine {
  type: LineType
  content: string
}

/** Parse a unified diff patch into classified lines */
function parseDiff(patch: string): DiffLine[] {
  const lines = patch.split('\n')
  const result: DiffLine[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('@@')) {
      result.push({ type: 'hunk', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line })
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line })
    } else {
      result.push({ type: 'context', content: line })
    }
  }

  return result
}

/** Map line type to Tailwind classes */
function lineClass(type: LineType): string {
  switch (type) {
    case 'header':
      return 'text-blue-300'
    case 'hunk':
      return 'text-cyan-300 bg-cyan-500/5'
    case 'add':
      return 'text-green-300 bg-green-500/10'
    case 'remove':
      return 'text-red-300 bg-red-500/10'
    case 'context':
      return 'text-text-secondary'
  }
}

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function DiffViewer({ diff, isLoading, title }: DiffViewerProps) {
  const parsedLines = useMemo(() => {
    if (!diff?.patch) return []
    return parseDiff(diff.patch)
  }, [diff])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-text-tertiary">
        Loading diff...
      </div>
    )
  }

  if (!diff || !diff.patch) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-text-tertiary">
        Select a file to view its diff
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      {title && (
        <div className="px-3 py-1.5 text-xs font-mono border-b border-surface-800/50 text-text-secondary truncate" title={title}>
          {title}
        </div>
      )}

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        <pre className="text-[11px] leading-5 font-mono p-2">
          {parsedLines.map((line, i) => (
            <div key={i} className={`${lineClass(line.type)} whitespace-pre`}>{line.content}</div>
          ))}
        </pre>
      </div>
    </div>
  )
}
