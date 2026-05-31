/**
 * BranchSelector — Dropdown to view, create, and switch branches.
 * Shows current branch and lists all local branches.
 * Follows design from docs/features/github-interaction.md.
 */

import React, { useState, useCallback } from 'react'
import type { GitBranchListResult } from '../../../../shared/ipc-types'
import { GitBranchIcon, ChevronDownIcon, PlusIcon } from './GitIcons'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '../ui/popover'
import { Input } from '../ui/input'

// ━━ Props ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface BranchSelectorProps {
  /** Branch list data */
  branches: GitBranchListResult
  /** Switch branch handler */
  onSwitchBranch: (name: string) => Promise<void>
  /** Create branch handler */
  onCreateBranch: (name: string, checkout?: boolean) => Promise<void>
  /** Whether an operation is in progress */
  isLoading: boolean
}

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function BranchSelector({ branches, onSwitchBranch, onCreateBranch, isLoading }: BranchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')

  // Filter to local branches only for the dropdown
  const localBranches = branches.branches.filter((b) => !b.isRemote)
  const currentBranch = branches.current

  const handleSwitch = useCallback(
    async (name: string) => {
      if (name === currentBranch) {
        setIsOpen(false)
        return
      }
      try {
        await onSwitchBranch(name)
        setIsOpen(false)
      } catch {
        // Error handled by parent
      }
    },
    [currentBranch, onSwitchBranch]
  )

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name) return
    try {
      await onCreateBranch(name, true)
      setNewBranchName('')
      setIsCreating(false)
      setIsOpen(false)
    } catch {
      // Error handled by parent
    }
  }, [newBranchName, onCreateBranch])

  const handleNewBranchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleCreateBranch()
      } else if (e.key === 'Escape') {
        setIsCreating(false)
      }
    },
    [handleCreateBranch]
  )

  return (
    <Popover open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setIsCreating(false) }}>
      {/* Current branch button — triggers the popover */}
      <PopoverTrigger asChild>
        <button
          className="
            flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs
            hover:bg-surface-800/60 text-text-secondary hover:text-text-primary transition-colors
            max-w-[200px]
          "
          title={`Current branch: ${currentBranch || 'none'}`}
        >
          <GitBranchIcon size={14} className="text-accent shrink-0" />
          <span className="truncate">{currentBranch || 'No branch'}</span>
          <ChevronDownIcon size={12} className="text-text-tertiary shrink-0" />
        </button>
      </PopoverTrigger>

      {/* Dropdown content — Popover handles positioning and click-outside */}
      <PopoverContent
        align="start"
        className="w-64 p-0 rounded-lg border-surface-700/50 bg-surface-900 shadow-2xl shadow-surface-950/60 overflow-hidden"
      >
        {/* Branch list */}
        <div className="max-h-60 overflow-y-auto py-1">
          {localBranches.map((branch) => (
            <button
              key={branch.name}
              className={`
                w-full text-left px-3 py-1.5 text-xs flex items-center gap-2
                ${branch.current ? 'bg-accent/10 text-accent' : 'hover:bg-surface-800/60 text-text-secondary'}
              `}
              onClick={() => handleSwitch(branch.name)}
              disabled={isLoading || branch.current}
            >
              <GitBranchIcon size={12} className={branch.current ? 'text-accent' : 'text-text-tertiary'} />
              <span className="truncate">{branch.name}</span>
              {branch.current && (
                <span className="ml-auto text-[10px] text-accent/60">current</span>
              )}
            </button>
          ))}

          {localBranches.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-tertiary">No branches found</div>
          )}
        </div>

        {/* Create new branch */}
        <div className="border-t border-surface-800/50 p-2">
          {isCreating ? (
            <div className="flex items-center gap-1">
              <Input
                className="flex-1 h-7 text-xs rounded-md border-surface-700/50 bg-surface-950 px-2 py-1
                  focus-visible:ring-accent/50 placeholder:text-text-tertiary"
                placeholder="Branch name..."
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={handleNewBranchKeyDown}
                autoFocus
              />
              <button
                className="rounded px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white
                  disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim() || isLoading}
              >
                Create
              </button>
            </div>
          ) : (
            <button
              className="flex items-center gap-1 w-full rounded-md px-2 py-1 text-xs text-text-tertiary
                hover:bg-surface-800/60 hover:text-text-primary transition-colors"
              onClick={() => setIsCreating(true)}
            >
              <PlusIcon size={14} />
              <span>Create Branch</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
