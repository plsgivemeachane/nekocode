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

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useGitOperations } from '../../hooks/useGitOperations'
import { BranchSelector } from './BranchSelector'
import { GitActions } from './GitActions'
import { StagingArea } from './StagingArea'
import { CommitInput } from './CommitInput'
import { DiffViewer } from './DiffViewer'
import { StashIcon, GitCommitIcon, RefreshIcon } from './GitIcons'
import { useProjectStore } from '../../stores/project-store'
import { ScrollArea } from '../ui/scroll-area'

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

  // ── Resizable panel state ──
  // Left panel (staging + commit) width — default 288px (w-72)
  const [leftPanelWidth, setLeftPanelWidth] = useState(288)
  // Bottom panel (recent commits) height — default 180px (roughly max-h-48)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(180)

  // Drag state refs for resize handles
  const isDraggingLeftRef = useRef(false)
  const dragStartX = useRef(0)
  const dragStartLeftWidth = useRef(0)

  const isDraggingBottomRef = useRef(false)
  const dragStartY = useRef(0)
  const dragStartBottomHeight = useRef(0)

  // Store active resize handlers so they can be cleaned up on unmount mid-drag
  const activeLeftResizeHandlers = useRef<{ mousemove: ((e: MouseEvent) => void) | null; mouseup: (() => void) | null }>({ mousemove: null, mouseup: null })
  const activeBottomResizeHandlers = useRef<{ mousemove: ((e: MouseEvent) => void) | null; mouseup: (() => void) | null }>({ mousemove: null, mouseup: null })

  // Hover state for resize handle visual feedback
  const [isHoveringLeftResize, setIsHoveringLeftResize] = useState(false)
  const [isHoveringBottomResize, setIsHoveringBottomResize] = useState(false)
  const [isDraggingLeftState, setIsDraggingLeftState] = useState(false)
  const [isDraggingBottomState, setIsDraggingBottomState] = useState(false)

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

  // ── Resize handle: left/right panel split ──
  const handleLeftResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingLeftRef.current = true
      setIsDraggingLeftState(true)
      dragStartX.current = e.clientX
      dragStartLeftWidth.current = leftPanelWidth

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingLeftRef.current) return
        // Dragging right = wider left panel
        const delta = moveEvent.clientX - dragStartX.current
        const newWidth = Math.max(200, Math.min(600, dragStartLeftWidth.current + delta))
        setLeftPanelWidth(newWidth)
      }

      const handleMouseUp = () => {
        isDraggingLeftRef.current = false
        setIsDraggingLeftState(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        activeLeftResizeHandlers.current = { mousemove: null, mouseup: null }
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      activeLeftResizeHandlers.current = { mousemove: handleMouseMove, mouseup: handleMouseUp }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [leftPanelWidth],
  )

  // ── Resize handle: main/bottom panel split ──
  const handleBottomResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingBottomRef.current = true
      setIsDraggingBottomState(true)
      dragStartY.current = e.clientY
      dragStartBottomHeight.current = bottomPanelHeight

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingBottomRef.current) return
        // Dragging up = taller bottom panel (delta is negative when moving up)
        const delta = dragStartY.current - moveEvent.clientY
        const newHeight = Math.max(60, Math.min(400, dragStartBottomHeight.current + delta))
        setBottomPanelHeight(newHeight)
      }

      const handleMouseUp = () => {
        isDraggingBottomRef.current = false
        setIsDraggingBottomState(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        activeBottomResizeHandlers.current = { mousemove: null, mouseup: null }
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      activeBottomResizeHandlers.current = { mousemove: handleMouseMove, mouseup: handleMouseUp }
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [bottomPanelHeight],
  )

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      if (activeLeftResizeHandlers.current.mousemove) {
        document.removeEventListener('mousemove', activeLeftResizeHandlers.current.mousemove)
      }
      if (activeLeftResizeHandlers.current.mouseup) {
        document.removeEventListener('mouseup', activeLeftResizeHandlers.current.mouseup)
      }
      if (activeBottomResizeHandlers.current.mousemove) {
        document.removeEventListener('mousemove', activeBottomResizeHandlers.current.mousemove)
      }
      if (activeBottomResizeHandlers.current.mouseup) {
        document.removeEventListener('mouseup', activeBottomResizeHandlers.current.mouseup)
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

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

      {/* ── Main content: staging + diff (resizable left/right) ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left panel: staging + commit */}
        <ScrollArea className="border-r border-surface-800/50 shrink-0" style={{ width: leftPanelWidth }}>
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
        </ScrollArea>

        {/* ── Vertical resize handle (left/right split) ── */}
        <div
          className="absolute top-0 bottom-0 w-3 cursor-col-resize z-10 group/resize-lr"
          style={{ left: leftPanelWidth - 6 }}
          onMouseDown={handleLeftResizeMouseDown}
          onMouseEnter={() => setIsHoveringLeftResize(true)}
          onMouseLeave={() => setIsHoveringLeftResize(false)}
        >
          {/* Small floating stick indicator (like RightSidebar) */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-0.75 rounded-full transition-all duration-200 ${
              isHoveringLeftResize || isDraggingLeftState
                ? 'h-12 bg-surface-400/70'
                : 'h-8 bg-surface-600/60 group-hover/resize-lr:h-10 group-hover/resize-lr:bg-surface-500/80'
            }`}
          />
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

      {/* ── Horizontal resize handle (main/bottom split) ── */}
      <div
        className="h-3 cursor-row-resize z-10 relative group/resize-tb shrink-0"
        onMouseDown={handleBottomResizeMouseDown}
        onMouseEnter={() => setIsHoveringBottomResize(true)}
        onMouseLeave={() => setIsHoveringBottomResize(false)}
      >
        {/* Horizontal stick indicator */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-0.75 rounded-full transition-all duration-200 ${
            isHoveringBottomResize || isDraggingBottomState
              ? 'w-12 bg-surface-400/70'
              : 'w-8 bg-surface-600/60 group-hover/resize-tb:w-10 group-hover/resize-tb:bg-surface-500/80'
          }`}
        />
      </div>

      {/* ── Bottom: recent commits (resizable height) ── */}
      <ScrollArea className="border-t border-surface-800/50" style={{ height: bottomPanelHeight }}>
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
      </ScrollArea>
    </div>
  )
}
