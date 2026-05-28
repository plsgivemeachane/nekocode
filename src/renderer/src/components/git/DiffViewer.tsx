/**
 * DiffViewer — Renders a unified/split diff patch with syntax highlighting.
 * Uses @pierre/diffs for professional diff rendering with Shiki-based
 * syntax highlighting, hunk expansion, split/unified toggle, and more.
 *
 * Replaces the Phase 1 plain-text DiffViewer with a full-featured
 * diff component from the @pierre/diffs library.
 *
 * @see docs/research/diffs-com.md for library details
 */

import React, { useState, useCallback, useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import type { FileDiffOptions } from '@pierre/diffs'
import type { GitDiffResult } from '../../../../shared/ipc-types'

/**
 * Props for the DiffViewer component.
 * Maintains backward compatibility with the original DiffViewer interface
 * used by GitCommandCenter.
 */
interface DiffViewerProps {
  /** Git diff result from the main process, or null if no diff selected */
  diff: GitDiffResult | null
  /** Whether the diff is currently being loaded */
  isLoading?: boolean
  /** Optional title (typically the file path) */
  title?: string
}

/**
 * Toggle button for switching between unified and split diff views.
 */
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
      {/* Split view icon */}
      {diffStyle === 'split' ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
          <path d="M14 0H8.5v16H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2m-1.5 6.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1a.5.5 0 0 1 1 0"/>
          <path d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5.5V0zm.5 7.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1" opacity=".3"/>
        </svg>
      ) : (
        /* Unified view icon */
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
 * DiffViewer renders git diff output using @pierre/diffs's PatchDiff component.
 *
 * Features provided by @pierre/diffs over the old plain-text renderer:
 * - Syntax highlighting (Shiki, matching existing MarkdownContent theme)
 * - Split and unified view toggle
 * - Hunk expand/collapse
 * - Line numbers
 * - Word-level change highlighting
 * - Custom hunk separators
 * - Shadow DOM style isolation (no Tailwind conflicts)
 *
 * Note: WorkerPool is disabled (disableWorkerPool) because setting up
 * Web Workers in Electron requires a custom workerFactory that points to
 * the bundled worker script. Main-thread rendering is sufficient for the
 * git diff viewer which renders one diff at a time. If worker-based
 * highlighting is needed in the future (e.g., for CodeView with many files),
 * we can set up WorkerPoolContextProvider with proper Electron worker config.
 */
export function DiffViewer({ diff, isLoading, title }: DiffViewerProps) {
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')

  const toggleDiffStyle = useCallback(() => {
    setDiffStyle(prev => prev === 'unified' ? 'split' : 'unified')
  }, [])

  // Build the @pierre/diffs options object.
  // Using pierre-dark theme to match NekoCode's dark UI.
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

  // Loading state — show skeleton/placeholder while diff is loading
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <div className="animate-spin h-6 w-6 border-2 border-accent-400 border-t-transparent rounded-full mb-3" />
        <span className="text-xs font-mono">Loading diff...</span>
      </div>
    )
  }

  // No diff available — show empty state
  if (!diff?.patch) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="mb-2 opacity-40">
          <path d="M2 4.5L6 2l4 2.5v3L6 10l-4-2.5v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
        </svg>
        <span className="text-xs font-mono">No diff to display</span>
      </div>
    )
  }

  // Render the diff with @pierre/diffs PatchDiff component
  // Using disableWorkerPool to avoid needing Web Worker setup in Electron.
  // The component handles parsing, syntax highlighting, and rendering
  // on the main thread, which is fine for single-file git diffs.
  return (
    <div className="flex flex-col h-full">
      {/* Header with title and view toggle */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-800/60 bg-surface-900/70">
        <span className="text-[12px] font-mono text-text-secondary truncate" title={title}>
          {title || 'Diff'}
        </span>
        <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyle} />
      </div>

      {/* The @pierre/diffs PatchDiff component renders inside a Shadow DOM,
          so its styles are fully isolated from our Tailwind classes.
          It receives the raw patch string and handles parsing internally. */}
      <div className="flex-1 overflow-auto">
        <PatchDiff
          patch={diff.patch}
          options={diffOptions}
          disableWorkerPool
          className="diff-viewer-root"
        />
      </div>
    </div>
  )
}
