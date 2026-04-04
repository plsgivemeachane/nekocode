import React from 'react'
import { extractToolSummary } from './tool-summary'

interface ToolCallData {
  id: string
  toolName: string
  status: 'running' | 'done'
  isError?: boolean
  args?: unknown
}

function StatusDot({ status, isError }: { status: 'running' | 'done'; isError?: boolean }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-[7px] w-[7px] flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-accent-400" />
      </span>
    )
  }
  if (isError) {
    return <span className="h-[7px] w-[7px] rounded-full bg-error flex-shrink-0" />
  }
  return <span className="h-[7px] w-[7px] rounded-full bg-success flex-shrink-0" />
}

function ToolCallRow({ toolName, status, isError, summary }: {
  toolName: string
  status: 'running' | 'done'
  isError?: boolean
  summary: string
}) {
  const shortName = toolName.replace(/^toolcall_/, '')

  return (
    <div className="flex items-center gap-2.5 px-3 py-[5px] hover:bg-surface-800/30 transition-colors">
      <StatusDot status={status} isError={isError} />
      <span className="text-[12px] font-mono font-medium text-text-secondary w-[88px] flex-shrink-0 truncate">{shortName}</span>
      <span className="text-[12px] font-mono text-text-tertiary truncate">{summary}</span>
    </div>
  )
}

export function ToolCallGroup({ toolCalls }: { toolCalls: ToolCallData[] }) {
  const totalCount = toolCalls.length
  const runningCount = toolCalls.filter(tc => tc.status === 'running').length
  const doneCount = toolCalls.filter(tc => tc.status === 'done' && !tc.isError).length

  return (
    <div className="rounded-lg border border-surface-800/80 bg-surface-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-[5px] border-b border-surface-800/60 bg-surface-900/70">
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
      </div>

      {/* Tool rows */}
      <div className="divide-y divide-surface-800/40">
        {toolCalls.map(tc => (
          <ToolCallRow
            key={tc.id}
            toolName={tc.toolName}
            status={tc.status}
            isError={tc.isError}
            summary={extractToolSummary(tc.toolName, tc.args)}
          />
        ))}
      </div>
    </div>
  )
}
