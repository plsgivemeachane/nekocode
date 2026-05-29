/**
 * ActivityRail — Collapsible side panel that shows diffs for tool call results.
 *
 * Lives inside ChatView as a sibling to the messages area.
 * When closed, it's invisible. When open, it takes ~50% of the
 * chat area width, showing a SessionDiffView with all file changes
 * from the current assistant response.
 *
 * Users can:
 * - Click a tool call row (write/edit) to open the rail and see its diff
 * - Click the close button or press Escape to close the rail
 * - Navigate between file diffs in the rail
 * - Toggle unified/split view within the diff
 */

import React, { useMemo, useEffect, useCallback } from 'react'
import { SessionDiffView } from './SessionDiffView'
import type { DiffEntry } from './SessionDiffView'
import { extractDiffStats } from './tool-summary'
import type { ChatMessage } from '../../types/chat'

interface ActivityRailProps {
  /** Whether the rail is currently open */
  isOpen: boolean
  /** Close the rail */
  onClose: () => void
  /** All messages from the current session (to extract diff entries) */
  messages: ChatMessage[]
  /** The tool call ID that was clicked to open the rail (scroll to it) */
  selectedToolCallId: string | null
}

/**
 * Build DiffEntry objects from the session's tool call messages.
 * Only write and edit tool calls that have completed with results
 * are included.
 */
function buildDiffEntries(messages: ChatMessage[]): DiffEntry[] {
  const entries: DiffEntry[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant' || msg.type !== 'tool_call' || msg.status !== 'done') continue

    const short = msg.toolName.replace(/^toolcall_/, '')
    const args = msg.args as Record<string, unknown> | null | undefined
    const result = msg.result as Record<string, unknown> | null | undefined

    if (!args) continue

    if (short === 'write') {
      const filePath = typeof args.path === 'string' ? args.path : ''
      const newContent = typeof args.content === 'string' ? args.content : ''
      const previousContent = typeof result?.previousContent === 'string' ? result.previousContent : ''

      if (!filePath || !newContent) continue

      // Only include if there's actual content to diff
      if (previousContent === newContent) continue

      const stats = extractDiffStats(msg.toolName, args, result)
      entries.push({
        id: msg.id,
        filePath,
        toolName: short,
        oldContent: previousContent,
        newContent,
        stats: stats ?? { added: 0, removed: 0 },
      })
    } else if (short === 'edit') {
      const filePath = typeof args.path === 'string' ? args.path : ''
      if (!filePath) continue

      // For edit tool, we need to reconstruct the old content from the edits
      // Since we don't have the full old content, we'll show a simplified diff
      // using oldText/newText from each edit
      const edits = Array.isArray(args.edits) ? args.edits : [] as Array<Record<string, unknown>>
      if (edits.length === 0) continue

      // Build old and new content from the edits array
      let oldContent = ''
      let newContent = ''
      for (const edit of edits) {
        const e = edit as Record<string, unknown>
        const oldText = typeof e.oldText === 'string' ? e.oldText : ''
        const newText = typeof e.newText === 'string' ? e.newText : ''
        oldContent += oldText + '\n'
        newContent += newText + '\n'
      }

      const stats = extractDiffStats(msg.toolName, args, result)
      entries.push({
        id: msg.id,
        filePath,
        toolName: short,
        oldContent,
        newContent,
        stats: stats ?? { added: 0, removed: 0 },
      })
    }
  }

  return entries
}

export function ActivityRail({ isOpen, onClose, messages, selectedToolCallId }: ActivityRailProps) {
  // Build diff entries from messages
  const diffEntries = useMemo(() => buildDiffEntries(messages), [messages])

  // Handle Escape key to close the rail
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Scroll to the selected diff entry when the rail opens or selection changes
  useEffect(() => {
    if (!isOpen || !selectedToolCallId) return
    // Small delay to allow the DOM to render
    requestAnimationFrame(() => {
      const el = document.getElementById(`diff-entry-${selectedToolCallId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [isOpen, selectedToolCallId])

  const handleSelectEntry = useCallback((_id: string) => {
    // Future: could update selection state for highlighting
  }, [])

  if (!isOpen) return null

  return (
    <div
      className="w-[50%] min-w-[320px] max-w-[640px] h-full border-l border-surface-800/80 bg-surface-950 flex flex-col shrink-0"
      role="complementary"
      aria-label="File changes panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-800/60 bg-surface-900/70 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-muted">
            <path d="M2 4.5L6 2l4 2.5v3L6 10l-4-2.5v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="text-[12px] font-mono font-medium text-text-secondary">Changes</span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-surface-800/50 text-text-tertiary hover:text-text-secondary transition-colors"
          title="Close changes panel (Escape)"
          aria-label="Close changes panel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Diff content */}
      <div className="flex-1 min-h-0">
        <SessionDiffView
          entries={diffEntries}
          selectedId={selectedToolCallId}
          onSelectEntry={handleSelectEntry}
        />
      </div>
    </div>
  )
}
