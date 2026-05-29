/**
 * GitCommandCenter — The main Git operations panel.
 * Combines BranchSelector, GitActions, StagingArea, CommitInput,
 * and DiffViewer into a cohesive layout.
 *
 * Layout follows docs/features/github-interaction.md:
 * ┌─────────────────────────────────────────────────┐
 * │ BranchSelector │ Push Pull Fetch │ Stash      │
 * ├──────────────┬──────────────────────────────────┤
 * │ StagingArea  │ DiffViewer                       │
 * │ CommitInput  │                                   │
 * ├──────────────┴──────────────────────────────────┤
 * │ CommitLog (recent commits)                      │
 * └─────────────────────────────────────────────────┘
 */

import React, { useState, useCallback } from 'react'
import { useGitOperations } from '../../hooks/useGitOperations'
import { BranchSelector } from './BranchSelector'
import { GitActions } from './GitActions'
import { StagingArea } from './StagingArea'
import { CommitInput } from './CommitInput'
import { DiffViewer } from './DiffViewer'
import { StashIcon, GitCommitIcon, RefreshIcon } from './GitIcons'
import { useProjectStore } from '../../stores/project-store'

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GitCommandCenter() {
  const { state } = useProjectStore()
  const activeProjectPath = state.activeProjectPath
  const git = useGitOperations()

  // Track which file is selected for diff viewing
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [_selectedFileStaged, setSelectedFileStaged] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  // ── Handlers ──

  const handleFileSelect = useCallback((filePath: string, staged: boolean) => {
    setSelectedFilePath(filePath)
    setSelectedFileStaged(staged)
    git.viewDiff(filePath, staged)
  }, [git])

  const handleCommit = useCallback(async (message: string) => {
    setIsCommitting(true)
    try {
      await git.commit(message)
      setSelectedFilePath(null)
    } finally {
      setIsCommitting(false)
    }
  }, [git])

  const handlePush = useCallback(async () => {
    setIsPushing(true)
    try {
      await git.push()
    } finally {
      setIsPushing(false)
    }
  }, [git])

  const handlePull = useCallback(async () => {
    setIsPulling(true)
    try {
      await git.pull()
    } finally {
      setIsPulling(false)
    }
  }, [git])

  const handleFetch = useCallback(async () => {
    setIsFetching(true)
    try {
      await git.fetch()
    } finally {
      setIsFetching(false)
    }
  }, [git])

  const handleStash = useCallback(async () => {
    await git.stashChanges()
  }, [git])

  const isRemoteLoading = isPushing || isPulling || isFetching

  // ── No project open ──

  if (!activeProjectPath) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
        Open a project to use Git features
      </div>
    )
  }

  // ── Not a git repository ──

  if (git.isGitRepo === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
        <div className="text-text-tertiary text-sm text-center">
          This project is not a Git repository
        </div>
        <div className="text-text-quaternary text-xs text-center">
          Initialize a repository with <code className="bg-surface-800 px-1.5 py-0.5 rounded text-text-secondary">git init</code> to enable Git features
        </div>
      </div>
    )
  }

  // ── Render ──

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top toolbar: branch + actions ── */}
      <div className="flex items-center gap-2 border-b border-surface-800/50 px-3 py-2">
        <BranchSelector
          branches={git.branches}
          onSwitchBranch={git.switchBranch}
          onCreateBranch={git.createBranch}
          isLoading={git.isBranchesLoading}
        />

        <div className="flex-1" />

        <GitActions
          ahead={git.status.ahead}
          behind={git.status.behind}
          onPush={handlePush}
          onPull={handlePull}
          onFetch={handleFetch}
          isLoading={isRemoteLoading}
        />

        {/* Stash button */}
        <button
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs hover:bg-surface-800/60 text-text-secondary hover:text-text-primary transition-colors"
          onClick={handleStash}
          title="Stash current changes"
        >
          <StashIcon size={14} />
          <span>Stash</span>
        </button>

        {/* Refresh button */}
        <button
          className="rounded-md p-1.5 text-xs hover:bg-surface-800/60 text-text-tertiary hover:text-text-primary transition-colors"
          onClick={git.refreshAll}
          title="Refresh all Git data"
        >
          <RefreshIcon size={14} />
        </button>
      </div>

      {/* ── Error banner ── */}
      {git.error && (
        <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-red-500/10 text-red-400 border-b border-red-500/20 rounded-sm mx-2">
          <span className="truncate">{git.error}</span>
          <button
            className="ml-2 text-red-400/60 hover:text-red-300"
            onClick={git.clearError}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Main content: staging + diff ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: staging + commit */}
        <div className="w-72 flex flex-col border-r border-surface-800/50 overflow-y-auto shrink-0">
          <StagingArea
            staged={git.status.staged}
            unstaged={[...git.status.modified, ...git.status.untracked]}
            conflicting={git.status.conflicting}
            onFileSelect={handleFileSelect}
            selectedFilePath={selectedFilePath}
            onStage={git.stageFile}
            onUnstage={git.unstageFile}
            onStageAll={git.stageAll}
            onUnstageAll={git.unstageAll}
          />

          {/* Commit input at bottom of left panel */}
          <div className="mt-auto border-t border-surface-800/50">
            <CommitInput
              hasStagedChanges={git.status.staged.length > 0}
              onCommit={handleCommit}
              isCommitting={isCommitting}
            />
          </div>
        </div>

        {/* Right panel: diff viewer */}
        <div className="flex-1 overflow-hidden">
          <DiffViewer
            diff={git.selectedDiff}
            isLoading={git.isDiffLoading}
            title={selectedFilePath || undefined}
          />
        </div>
      </div>

      {/* ── Bottom: recent commits ── */}
      <div className="border-t border-surface-800/50 max-h-48 overflow-y-auto">
        <div className="px-3 py-1.5 text-xs font-semibold text-text-tertiary bg-surface-900/60">
          Recent Commits
        </div>
        {git.log.commits.length === 0 ? (
          <div className="px-3 py-2 text-xs text-text-tertiary">No commits yet</div>
        ) : (
          git.log.commits.slice(0, 10).map((commit) => (
            <div
              key={commit.hash}
              className="flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-surface-800/40"
            >
              <GitCommitIcon size={14} className="text-text-tertiary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-text-primary" title={commit.message}>
                  {commit.message}
                </div>
                <div className="text-[10px] text-text-tertiary">
                  <span className="font-mono">{commit.hashAbbrev}</span>
                  {' · '}
                  <span>{commit.author}</span>
                  {' · '}
                  <span>{commit.relativeDate || commit.date}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
