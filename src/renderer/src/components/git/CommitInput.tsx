/**
 * CommitInput — Textarea + button for creating commits.
 * Follows the design from docs/features/github-interaction.md:
 * - Multi-line textarea for commit message
 * - Commit button enabled only when message is non-empty and there are staged changes
 * - Supports Ctrl+Enter to submit
 */

import React, { useState, useCallback, useRef } from 'react'
import { CheckIcon } from './GitIcons'

// ━━ Props ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface CommitInputProps {
  /** Whether there are staged changes to commit */
  hasStagedChanges: boolean
  /** Commit handler */
  onCommit: (message: string) => Promise<void>
  /** Whether a commit is in progress */
  isCommitting: boolean
}

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function CommitInput({ hasStagedChanges, onCommit, isCommitting }: CommitInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canCommit = hasStagedChanges && message.trim().length > 0 && !isCommitting

  const handleCommit = useCallback(async () => {
    if (!canCommit) return
    try {
      await onCommit(message.trim())
      setMessage('')
    } catch {
      // Error is handled by the parent hook
    }
  }, [canCommit, message, onCommit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter or Cmd+Enter to commit
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleCommit()
      }
    },
    [handleCommit]
  )

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Commit message textarea */}
      <textarea
        ref={textareaRef}
        className="
          w-full resize-none rounded-lg border border-surface-700/50 bg-surface-950
          px-3 py-2 text-sm placeholder:text-text-tertiary
          focus:outline-none focus:ring-1 focus:ring-accent/50
          disabled:opacity-50 disabled:cursor-not-allowed
        "
        rows={3}
        placeholder={hasStagedChanges ? 'Commit message (Ctrl+Enter to commit)...' : 'No staged changes to commit'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!hasStagedChanges}
      />

      {/* Commit button */}
      <button
        className={`
          flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium
          transition-colors
          ${canCommit
            ? 'bg-green-600 hover:bg-green-500 text-white'
            : 'bg-surface-800/40 text-text-tertiary cursor-not-allowed'
          }
        `}
        onClick={handleCommit}
        disabled={!canCommit}
        title={canCommit ? 'Commit staged changes' : 'Stage changes and enter a message to commit'}
      >
        <CheckIcon size={14} />
        {isCommitting ? 'Committing...' : 'Commit'}
      </button>
    </div>
  )
}
