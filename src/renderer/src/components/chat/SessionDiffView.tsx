/**
 * SessionDiffView — Renders diffs for file-modifying tool calls in a session.
 *
 * Shows a PatchDiff from @pierre/diffs for each write/edit tool call,
 * allowing the user to see exactly what changed in each file.
 *
 * Uses the previousContent (from tool result) and content/edits (from tool args)
 * to generate a unified diff patch string, rendered via PatchDiff.
 */

import React, { useMemo, useState, useCallback } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import type { FileDiffOptions } from '@pierre/diffs'
import { createTwoFilesPatch } from 'diff'

/** A single file diff entry for the session diff view */
export interface DiffEntry {
  /** Unique ID for this diff entry (typically the tool call ID) */
  id: string
  /** File path being modified */
  filePath: string
  /** Tool name that made the change (e.g. "write", "edit") */
  toolName: string
  /** Original file content (before the change) */
  oldContent: string
  /** New file content (after the change) */
  newContent: string
  /** Line-level diff stats */
  stats: { added: number; removed: number }
}

export interface SessionDiffViewProps {
  /** Diff entries to display */
  entries: DiffEntry[]
  /** Currently selected entry ID (to scroll to / highlight) */
  selectedId?: string | null
  /** Callback when user selects an entry */
  onSelectEntry?: (id: string) => void
}

/**
 * Generate a unified diff patch string from old and new content.
 * Uses the `diff` npm package's createTwoFilesPatch for proper
 * unified diff format that @pierre/diffs can parse.
 */
function generatePatch(oldContent: string, newContent: string, filePath: string): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent, '', '')
}

/** Toggle button for switching between unified and split diff views. */
function DiffStyleToggle({ diffStyle, onToggle }: {
  diffStyle: 'unified' | 'split'
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono
        text-text-tertiary hover:text-text-secondary
        border border-surface-700/60 rounded-md
        hover:bg-surface-800/50 transition-colors"
      title={`Switch to ${diffStyle === 'unified' ? 'split' : 'unified'} view`}
    >
      {diffStyle === 'split' ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
          <path d="M14 0H8.5v16H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2m-1.5 6.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1a.5.5 0 0 1 1 0"/>
          <path d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5.5V0zm.5 7.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1" opacity=".3"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
          <path fillRule="evenodd" d="M16 14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V8.5h16zm-8-4a.5.5 0 0 0-.5.5v1h-1a.5.5 0 0 0 0 1h1v1a.5.5 0 0 0 1 0v-1h1a.5.5 0 0 0 0-1h-1v-1A.5.5 0 0 0 8 10" clipRule="evenodd"/>
          <path fillRule="evenodd" d="M14 0a2 2 0 0 1 2 2v5.5H0V2a2 2 0 0 1 2-2zM6.5 3.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" clipRule="evenodd" opacity=".4"/>
        </svg>
      )}
      <span>{diffStyle === 'unified' ? 'Unified' : 'Split'}</span>
    </button>
  )
}

/**
 * SessionDiffView renders a list of diff entries, each with its own PatchDiff.
 *
 * When multiple files were modified, each file gets its own diff section
 * with a file header showing the path and change stats.
 */
export function SessionDiffView({ entries, selectedId, onSelectEntry }: SessionDiffViewProps) {
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')

  const toggleDiffStyle = useCallback(() => {
    setDiffStyle(prev => prev === 'unified' ? 'split' : 'unified')
  }, [])

  // Build the @pierre/diffs options object.
  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({
    theme: 'pierre-dark',
    themeType: 'dark',
    diffStyle,
    // Show word-level diff highlights within changed lines
    lineDiffType: 'word',
    // Show metadata (file path, change stats) between diff hunks
    hunkSeparators: 'metadata',
    // Allow expanding unchanged regions between hunks
    expandUnchanged: true,
    // How many context lines to show around changes before collapsing
    collapsedContextThreshold: 4,
    // How many lines to expand per click
    expansionLineCount: 4,
    // Sticky file header on scroll
    stickyHeader: true,
  }), [diffStyle])

  // If no entries, show empty state
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="mb-2 opacity-40">
          <path d="M2 4.5L6 2l4 2.5v3L6 10l-4-2.5v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
        </svg>
        <span className="text-xs font-mono">No file changes in this response</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-800/60 bg-surface-900/70 shrink-0">
        <span className="text-[12px] font-mono text-text-secondary">
          {(() => {
            // Count unique files — multiple edits to the same file count as 1 file changed
            const uniqueFileCount = new Set(entries.map(e => e.filePath)).size
            return `${uniqueFileCount} file${uniqueFileCount !== 1 ? 's' : ''} changed`
          })()}
        </span>
        <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyle} />
      </div>

      {/* Scrollable list of diffs */}
      <div className="flex-1 overflow-auto">
        {entries.map((entry) => {
          const patch = generatePatch(entry.oldContent, entry.newContent, entry.filePath)
          const isSelected = entry.id === selectedId

          return (
            <div
              key={entry.id}
              id={`diff-entry-${entry.id}`}
              className={`border-b border-surface-800/40 ${isSelected ? 'ring-1 ring-accent-500/30' : ''}`}
              onClick={() => onSelectEntry?.(entry.id)}
            >
              {/* Per-file header */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-900/50 border-b border-surface-800/30">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-text-muted shrink-0">
                  <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <span className="text-[11px] font-mono text-text-secondary truncate flex-1">{entry.filePath}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0">
                  {entry.stats.added > 0 && <span className="text-[#4ade80]">+{entry.stats.added}</span>}
                  {entry.stats.removed > 0 && <span className="text-[#f87171]">-{entry.stats.removed}</span>}
                </span>
              </div>

              {/* The PatchDiff component renders inside a Shadow DOM */}
              <PatchDiff
                patch={patch}
                options={diffOptions}
                disableWorkerPool
                className="diff-viewer-root"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
