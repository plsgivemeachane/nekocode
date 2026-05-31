/**
 * SessionDiffView — Renders diffs for file-modifying tool calls in a session.
 *
 * Shows a PatchDiff from @pierre/diffs for each write/edit tool call,
 * allowing the user to see exactly what changed in each file.
 *
 * Uses the previousContent (from tool result) and content/edits (from tool args)
 * to generate a unified diff patch string, rendered via PatchDiff.
 *
 * PERFORMANCE: Uses react-virtuoso for virtualized rendering. Only diff entries
 * visible in the viewport (plus an overscan buffer) are mounted in the DOM.
 * This prevents screen lag when a session has 50+ edits, each with large diffs —
 * the browser no longer renders thousands of off-screen DOM nodes.
 * Same approach as MessagesTimeline for the message list.
 */

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
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
 * SessionDiffView renders a VIRTUALIZED list of diff entries, each with its own PatchDiff.
 *
 * The @pierre/diffs PatchDiff component renders its own file header from the
 * patch content (showing filename and change stats), so we don't add a separate
 * custom header. This avoids duplicate/mismatched headers.
 *
 * Uses react-virtuoso (same as MessagesTimeline) to virtualize rendering.
 * Only diff entries visible in the viewport are mounted in the DOM, preventing
 * screen lag when sessions have many large diffs.
 */
export function SessionDiffView({ entries, selectedId, onSelectEntry }: SessionDiffViewProps) {
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const virtuosoRef = useRef<VirtuosoHandle>(null)

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

  // Scroll to the selected entry when selectedId changes
  useEffect(() => {
    if (!selectedId || !virtuosoRef.current) return
    const index = entries.findIndex(e => e.id === selectedId)
    if (index >= 0) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: 'start',
        behavior: 'smooth',
      })
    }
  }, [selectedId, entries])

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

      {/* Virtualized list of diffs — only visible entries are rendered in the DOM */}
      <Virtuoso
        ref={virtuosoRef}
        data={entries}
        overscan={200}
        defaultItemHeight={150}
        itemContent={(index) => {
          const entry = entries[index]
          const patch = generatePatch(entry.oldContent, entry.newContent, entry.filePath)
          const isSelected = entry.id === selectedId

          return (
            <div
              id={`diff-entry-${entry.id}`}
              className={`border-b border-surface-800/40 ${isSelected ? 'ring-1 ring-surface-500/30' : ''}`}
              onClick={() => onSelectEntry?.(entry.id)}
            >
              {/* The PatchDiff component renders its own file header from the patch content,
                  so we don't need a separate custom header. The @pierre/diffs header shows
                  the filename and change stats, matching the patch's --- a/ and +++ b/ lines. */}
              <PatchDiff
                patch={patch}
                options={diffOptions}
                disableWorkerPool
                className="diff-viewer-root"
              />
            </div>
          )
        }}
        className="outline-none"
      />
    </div>
  )
}
