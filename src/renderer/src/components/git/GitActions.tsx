/**
 * GitActions — Push / Pull / Fetch action bar.
 * Shows ahead/behind counts and buttons for remote operations.
 * Follows design from docs/features/github-interaction.md.
 */

import React from 'react'
import { PushIcon, PullIcon, RefreshIcon } from './GitIcons'

// ━━ Props ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface GitActionsProps {
  /** Number of commits ahead of remote */
  ahead: number
  /** Number of commits behind remote */
  behind: number
  /** Push handler */
  onPush: () => Promise<void>
  /** Pull handler */
  onPull: () => Promise<void>
  /** Fetch handler */
  onFetch: () => Promise<void>
  /** Whether an operation is in progress */
  isLoading: boolean
}

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GitActions({ ahead, behind, onPush, onPull, onFetch, isLoading }: GitActionsProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5">
      {/* Push */}
      <button
        className="
          flex items-center gap-1 rounded px-2 py-1 text-xs
          hover:bg-white/10 transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
        "
        onClick={onPush}
        disabled={isLoading || ahead === 0}
        title="Push to remote"
      >
        <PushIcon size={14} />
        <span>Push</span>
        {ahead > 0 && (
          <span className="ml-0.5 px-1 rounded bg-green-500/20 text-green-400 text-[10px] font-bold">
            {ahead}
          </span>
        )}
      </button>

      {/* Pull */}
      <button
        className="
          flex items-center gap-1 rounded px-2 py-1 text-xs
          hover:bg-white/10 transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
        "
        onClick={onPull}
        disabled={isLoading}
        title="Pull from remote"
      >
        <PullIcon size={14} />
        <span>Pull</span>
        {behind > 0 && (
          <span className="ml-0.5 px-1 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold">
            {behind}
          </span>
        )}
      </button>

      {/* Fetch */}
      <button
        className="
          flex items-center gap-1 rounded px-2 py-1 text-xs
          hover:bg-white/10 transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
        "
        onClick={onFetch}
        disabled={isLoading}
        title="Fetch from remote"
      >
        <RefreshIcon size={14} />
        <span>Fetch</span>
      </button>
    </div>
  )
}
