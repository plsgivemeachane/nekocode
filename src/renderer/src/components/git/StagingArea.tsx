/**
 * StagingArea — Shows staged and unstaged file lists
 * with stage/unstage buttons per file and bulk actions.
 *
 * Follows the design from docs/features/github-interaction.md:
 * - Staged Changes section with unstage per file
 * - Changes section (unstaged + untracked) with stage per file
 * - Color-coded status badges (M=yellow, A=green, D=red, ?=gray)
 */

import React, { useCallback } from 'react'
import type { GitFileStatus } from '../../../../shared/ipc-types'
import { PlusIcon, MinusIcon, FileChangedIcon } from './GitIcons'

// ━━ Status color mapping ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Map a git status code to a display label and color */
function getStatusStyle(code: string): { label: string; colorClass: string } {
  switch (code) {
    case 'M':
      return { label: 'M', colorClass: 'text-yellow-500' }
    case 'A':
      return { label: 'A', colorClass: 'text-green-500' }
    case 'D':
      return { label: 'D', colorClass: 'text-red-500' }
    case 'R':
      return { label: 'R', colorClass: 'text-orange-500' }
    case 'C':
      return { label: 'C', colorClass: 'text-blue-500' }
    case '?':
      return { label: 'U', colorClass: 'text-text-tertiary' }
    case '!':
      return { label: 'I', colorClass: 'text-text-tertiary' }
    case 'U':
      return { label: 'C', colorClass: 'text-red-600' } // conflict
    default:
      return { label: code || '·', colorClass: 'text-text-tertiary' }
  }
}

// ━━ Props ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface StagingAreaProps {
  /** Staged files */
  staged: GitFileStatus[]
  /** Unstaged (modified + untracked) files */
  unstaged: GitFileStatus[]
  /** Conflicting files */
  conflicting: GitFileStatus[]
  /** Callback when a file is clicked (for diff viewing) */
  onFileSelect: (filePath: string, staged: boolean) => void
  /** Currently selected file path */
  selectedFilePath: string | null
  /** Stage a single file */
  onStage: (filePath: string) => void
  /** Unstage a single file */
  onUnstage: (filePath: string) => void
  /** Stage all changes */
  onStageAll: () => void
  /** Unstage all changes */
  onUnstageAll: () => void
}

// ━━ File row sub-component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface FileRowProps {
  file: GitFileStatus
  /** Which status code to show (index or workingTree) */
  statusCode: string
  /** Whether this row is selected */
  isSelected: boolean
  /** Click handler */
  onClick: () => void
  /** Action button icon: stage (+) or unstage (-) */
  actionIcon: 'stage' | 'unstage'
  /** Action button handler */
  onAction: () => void
}

function FileRow({ file, statusCode, isSelected, onClick, actionIcon, onAction }: FileRowProps) {
  const { label, colorClass } = getStatusStyle(statusCode)

  // Split path into directory and filename for better readability
  // e.g. "src/components/git/StagingArea.tsx" → dir="src/components/git/", name="StagingArea.tsx"
  const lastSlash = file.path.lastIndexOf('/')
  const dirPart = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : ''
  const namePart = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path

  return (
    <div
      className={`
        flex items-center gap-2 px-2 py-1 text-xs cursor-pointer group
        ${isSelected ? 'bg-surface-700/50 text-text-primary' : 'hover:bg-surface-800/40 text-text-secondary'}
      `}
      onClick={onClick}
    >
      {/* Status badge — fixed width, never shrinks */}
      <span className={`w-4 shrink-0 text-center font-mono font-bold ${colorClass}`} title={statusCode}>
        {label}
      </span>

      {/* File path — min-w-0 required for truncate in flex; shows dir+name split */}
      <span className="flex-1 min-w-0 truncate" title={file.path}>
        {dirPart && (
          <span className="text-text-tertiary">{dirPart}</span>
        )}
        <span className="text-text-primary">{namePart}</span>
      </span>

      {/* Stage/Unstage button — always visible, shrinks to never, compact */}
      <button
        className="
          shrink-0 p-0.5 rounded-md hover:bg-surface-800/60
          text-text-tertiary hover:text-text-primary
          opacity-50 group-hover:opacity-100 transition-opacity
        "
        onClick={(e) => {
          e.stopPropagation()
          onAction()
        }}
        title={actionIcon === 'stage' ? 'Stage file' : 'Unstage file'}
      >
        {actionIcon === 'stage' ? (
          <PlusIcon size={14} className="text-green-400" />
        ) : (
          <MinusIcon size={14} className="text-red-400" />
        )}
      </button>
    </div>
  )
}

// ━━ StagingArea component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function StagingArea({
  staged,
  unstaged,
  conflicting,
  onFileSelect,
  selectedFilePath,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
}: StagingAreaProps) {
  const hasStaged = staged.length > 0
  const hasUnstaged = unstaged.length > 0
  const hasConflicts = conflicting.length > 0

  const handleFileClick = useCallback(
    (filePath: string, isStaged: boolean) => {
      onFileSelect(filePath, isStaged)
    },
    [onFileSelect]
  )

  return (
    <div className="flex flex-col text-xs select-none">
      {/* ── Conflicting files (if any) ── */}
      {hasConflicts && (
        <div className="mb-1">
          <div className="flex items-center gap-1 px-2 py-1.5 font-semibold text-red-400 bg-red-500/5">
            <FileChangedIcon size={14} />
            <span>Merge Conflicts ({conflicting.length})</span>
          </div>
          {conflicting.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              statusCode={file.index}
              isSelected={selectedFilePath === file.path}
              onClick={() => handleFileClick(file.path, false)}
              actionIcon="stage"
              onAction={() => onStage(file.path)}
            />
          ))}
        </div>
      )}

      {/* ── Staged Changes ── */}
      <div className="mb-1">
        <div className="flex items-center justify-between px-2 py-1.5 font-semibold text-green-400 bg-green-500/5">
          <div className="flex items-center gap-1">
            <FileChangedIcon size={14} />
            <span>Staged Changes ({staged.length})</span>
          </div>
          {hasStaged && (
            <button
              className="p-0.5 rounded-md hover:bg-surface-800/60 text-green-400/60 hover:text-green-400"
              onClick={onUnstageAll}
              title="Unstage all"
            >
              <MinusIcon size={14} />
            </button>
          )}
        </div>
        {staged.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            statusCode={file.index}
            isSelected={selectedFilePath === file.path}
            onClick={() => handleFileClick(file.path, true)}
            actionIcon="unstage"
            onAction={() => onUnstage(file.path)}
          />
        ))}
      </div>

      {/* ── Changes (unstaged + untracked) ── */}
      <div>
        <div className="flex items-center justify-between px-2 py-1.5 font-semibold text-yellow-400 bg-yellow-500/5">
          <div className="flex items-center gap-1">
            <FileChangedIcon size={14} />
            <span>Changes ({unstaged.length})</span>
          </div>
          {hasUnstaged && (
            <button
              className="p-0.5 rounded-md hover:bg-surface-800/60 text-yellow-400/60 hover:text-yellow-400"
              onClick={onStageAll}
              title="Stage all"
            >
              <PlusIcon size={14} />
            </button>
          )}
        </div>
        {unstaged.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            statusCode={file.workingTree}
            isSelected={selectedFilePath === file.path}
            onClick={() => handleFileClick(file.path, false)}
            actionIcon="stage"
            onAction={() => onStage(file.path)}
          />
        ))}
      </div>
    </div>
  )
}
