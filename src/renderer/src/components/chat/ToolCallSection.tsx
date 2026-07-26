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

// ─── OpenCode TUI tool-call prefixes ──────────────────────────────────
// Each tool call renders as a SINGLE LINE prefixed with a small symbol that
// signals what kind of operation it is — like OpenCode's `→ Read`, `✱ Grep`.
// The prefix is dimmed; the tool name is the bright token.
const TOOL_PREFIX: Record<string, { glyph: string; label: string; cls: string }> = {
  read: { glyph: '→', label: 'Read', cls: 'text-accent-400' },
  write: { glyph: '✎', label: 'Write', cls: 'text-role-assistant-400' },
  edit: { glyph: '✎', label: 'Edit', cls: 'text-role-assistant-400' },
  bash: { glyph: '$', label: 'Bash', cls: 'text-success' },
  powershell: { glyph: '$', label: 'PS', cls: 'text-success' },
  grep: { glyph: '✱', label: 'Grep', cls: 'text-role-user-400' },
  glob: { glyph: '✱', label: 'Glob', cls: 'text-role-user-400' },
  file_skeleton: { glyph: '§', label: 'Skeleton', cls: 'text-accent-400' },
  repo_map: { glyph: '▦', label: 'Map', cls: 'text-accent-400' },
  lsp: { glyph: '⌖', label: 'LSP', cls: 'text-accent-400' },
  tilldone: { glyph: '✓', label: 'Tasks', cls: 'text-success' },
  ask_user: { glyph: '?', label: 'Ask', cls: 'text-role-assistant-400' },
}

function prefixFor(shortName: string): { glyph: string; label: string; cls: string } {
  return TOOL_PREFIX[shortName] ?? { glyph: '·', label: shortName, cls: 'text-text-tertiary' }
}

function StatusDot({ status }: { status: 'running' | 'done' }) {
  // ─── OpenCode TUI status indicator ──────────────────────────────────
  // - running → a small pinging dot (the only visual indicator).
  // - success → NOTHING (a clean log line, no redundant checkmark).
  // - error   → NOTHING here; the row TEXT is colored red instead (see
  //             ToolCallRow). We render an empty placeholder span so the dot
  //             column keeps its width and the layout doesn't shift when a
  //             tool transitions from running → done.
  if (status === 'running') {
    return (
      <span className="relative flex h-1.75 w-1.75 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-1.75 w-1.75 bg-accent-400" />
      </span>
    )
  }
  return <span className="h-1.75 w-1.75 shrink-0" aria-hidden="true" />
}

/** Inline diff stats badge: "+3 -1" style. Shows "0 changes" when added/removed are both 0
 *  to distinguish from null stats (not applicable). */
function DiffStatsBadge({ stats }: { stats: DiffStats }) {
  if (stats.added === 0 && stats.removed === 0) {
    return (
      <span data-diff-badge className="inline-flex items-center text-[11px] font-mono shrink-0 text-text-tertiary">
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
  const prefix = prefixFor(shortName)

  return (
    <div
      // `data-tool-row` is the stable test hook (replaces the old fragile
      // `[class*='px-3']` selector). `px-0` keeps tool calls flush-LEFT so
      // they align with the assistant message text above them (OpenCode flat
      // log layout — no left indent).
      data-tool-row
      className={`flex items-center gap-2 px-0 py-0.5 transition-colors font-mono text-[12px] ${
        isError
          ? 'text-error'
          : 'text-text-tertiary'
      } ${
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
      <StatusDot status={status} />
      {/* Prefix glyph + label — the "custom prefix" per tool (→ Read, ✱ Grep).
          On error the whole row is red (no separate error indicator). */}
      <span className={`shrink-0 select-none ${isError ? 'text-error' : prefix.cls}`}>
        <span className="mr-1">{prefix.glyph}</span>
        <span className="font-medium">{prefix.label}</span>
      </span>
      {/* Summary — the file path / command / args */}
      <span className="truncate flex-1 min-w-0">{summary}</span>
      {diffStats && <DiffStatsBadge stats={diffStats} />}
    </div>
  )
}

export function ToolCallGroup({ toolCalls, onToolCallClick }: {
  toolCalls: ToolCallData[]
  onToolCallClick?: (toolCallId: string) => void
}) {
  // Compute diff stats once per tool call (cache to avoid redundant recomputation)
  // Previously called 3x per tool call (totalAdded + totalRemoved + row) — now called 1x
  const toolCallStats = toolCalls.map(tc => extractDiffStats(tc.toolName, tc.args, tc.result))

  // ─── OpenCode TUI styling ──────────────────────────────────────────
  // FLAT layout — NO header, NO grouping box. Tool calls are just stacked
  // single lines rendered directly under the assistant message, exactly like
  // OpenCode's log output. Each line carries its own status dot, prefix,
  // summary, and per-row diff badge.
  return (
    <div className="font-mono">
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
  )
}

// Re-export ToolCallData for use in ChatView
export type { ToolCallData }