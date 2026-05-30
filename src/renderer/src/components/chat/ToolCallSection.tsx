import React from 'react'
import { extractToolSummary, extractDiffStats } from './tool-summary'
import type { DiffStats } from './tool-summary'

interface ToolCallData {
  id: string
  toolName: string
  status: 'running' | 'done'
  isError?: boolean
  args?: unknown
  result?: unknown
}

function StatusDot({ status, isError }: { status: 'running' | 'done'; isError?: boolean }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-1.75 w-1.75 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-1.75 w-1.75 bg-accent-400" />
      </span>
    )
  }
  if (isError) {
    return <span className="h-1.75 w-1.75 rounded-full bg-error shrink-0" />
  }
  return <span className="h-1.75 w-1.75 rounded-full bg-success shrink-0" />
}

/** Inline diff stats badge: "+3 -1" style. Shows "0 changes" when added/removed are both 0
 *  to distinguish from null stats (not applicable). */
function DiffStatsBadge({ stats }: { stats: DiffStats }) {
  if (stats.added === 0 && stats.removed === 0) {
    return (
      <span data-diff-badge className="inline-flex items-center text-[11px] font-mono shrink-0 text-text-muted">
        0 changes
      </span>
    )
  }
  return (
    <span data-diff-badge className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0">
      {stats.added > 0 && (
        <span className="text-[#4ade80]">+{stats.added}</span>
      )}
      {stats.removed > 0 && (
        <span className="text-[#f87171]">-{stats.removed}</span>
      )}
    </span>
  )
}

function ToolCallRow({ toolName, status, isError, summary, diffStats, onClick }: {
  toolName: string
  status: 'running' | 'done'
  isError?: boolean
  summary: string
  diffStats: DiffStats | null
  onClick?: () => void
}) {
  const shortName = toolName.replace(/^toolcall_/, '')
  const isFileModifying = diffStats !== null

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-1.25 transition-colors ${
        isFileModifying
          ? 'hover:bg-surface-800/50 cursor-pointer'
          : 'hover:bg-surface-800/30'
      }`}
      onClick={isFileModifying ? onClick : undefined}
      role={isFileModifying ? 'button' : 'listitem'}
      tabIndex={isFileModifying ? 0 : -1}
      onKeyDown={isFileModifying ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      } : undefined}
      title={isFileModifying ? 'Click to view diff' : undefined}
    >
      <StatusDot status={status} isError={isError} />
      <span className="text-[12px] font-mono font-medium text-text-secondary w-22 shrink-0 truncate">{shortName}</span>
      <span className="text-[12px] font-mono text-text-tertiary truncate flex-1 min-w-0">{summary}</span>
      {diffStats && <DiffStatsBadge stats={diffStats} />}
    </div>
  )
}

export function ToolCallGroup({ toolCalls, onToolCallClick }: { 
  toolCalls: ToolCallData[]
  onToolCallClick?: (toolCallId: string) => void 
}) {
  const totalCount = toolCalls.length
  const runningCount = toolCalls.filter(tc => tc.status === 'running').length
  const doneCount = toolCalls.filter(tc => tc.status === 'done' && !tc.isError).length

  // Compute diff stats once per tool call (cache to avoid redundant recomputation)
  // Previously called 3x per tool call (totalAdded + totalRemoved + row) — now called 1x
  const toolCallStats = toolCalls.map(tc => extractDiffStats(tc.toolName, tc.args, tc.result))
  const totalAdded = toolCallStats.reduce((sum, stats) => sum + (stats?.added ?? 0), 0)
  const totalRemoved = toolCallStats.reduce((sum, stats) => sum + (stats?.removed ?? 0), 0)
  const hasAnyDiff = totalAdded > 0 || totalRemoved > 0

  return (
    <div className="rounded-lg border border-surface-800/80 bg-surface-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.25 border-b border-surface-800/60 bg-surface-900/70">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-text-muted">
          <path d="M2 4.5L6 2l4 2.5v3L6 10l-4-2.5v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M6 2v4" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 4.5L6 6l4-1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="text-[12px] font-mono text-text-secondary">{totalCount} tool call{totalCount !== 1 ? 's' : ''}</span>
        {runningCount > 0 && (
          <span className="text-[11px] font-mono text-accent-400">{runningCount} running</span>
        )}
        {doneCount > 0 && !runningCount && (
          <span className="text-[11px] font-mono text-text-muted">{doneCount} done</span>
        )}
        {/* Aggregate diff stats badge in header */}
        {hasAnyDiff && !runningCount && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-mono">
            {totalAdded > 0 && <span className="text-[#4ade80]">+{totalAdded}</span>}
            {totalRemoved > 0 && <span className="text-[#f87171]">-{totalRemoved}</span>}
          </span>
        )}
      </div>

      {/* Tool rows */}
      <div className="divide-y divide-surface-800/40">
        {toolCalls.map((tc, i) => (
          <ToolCallRow
            key={tc.id}
            toolName={tc.toolName}
            status={tc.status}
            isError={tc.isError}
            summary={extractToolSummary(tc.toolName, tc.args)}
            diffStats={toolCallStats[i]}
            onClick={onToolCallClick ? () => onToolCallClick(tc.id) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

// Re-export ToolCallData for use in ChatView
export type { ToolCallData }
