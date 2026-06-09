import React, { useState, useEffect, useCallback } from 'react'
import { useZoom } from '../../hooks/useZoom'
import { useProjectStore } from '../../stores/project-store'
import { VSCodeIcon } from '../icons/VSCodeIcon'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '../ui/tooltip'

/**
 * Top bar spanning the full window width in frameless mode.
 * Left: NekoCode logo + version
 * Center/Right: project actions (add project, open in vscode) + zoom controls + window control buttons (minimize, maximize, close)
 * The entire bar is a native drag region for the frameless window.
 */
export function NavBar() {
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
  const { addProject, setGitOverlay, state: projectState } = useProjectStore()
  const [isMaximized, setIsMaximized] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const percentage = Math.round(zoom * 100)

  // Subscribe to maximize state changes from the main process
  useEffect(() => {
    window.nekocode.window.isMaximized().then((maximized) => {
      setIsMaximized(maximized)
    }).catch(() => {
      // Ignore errors (e.g. window not ready)
    })

    const unsubscribe = window.nekocode.window.onMaximizedStateChange((maximized: boolean) => {
      setIsMaximized(maximized)
    })

    return unsubscribe
  }, [])

  const handleMinimize = useCallback(() => {
    window.nekocode.window.minimize()
  }, [])

  const handleMaximize = useCallback(() => {
    window.nekocode.window.maximize()
  }, [])

  const handleClose = useCallback(() => {
    window.nekocode.window.close()
  }, [])

  const handleAddProject = useCallback(async () => {
    const folder = await window.nekocode.dialog.openFolder()
    if (folder) {
      await addProject(folder)
    }
  }, [addProject])

  // Click-outside for dropdown handled by Radix Popover

  return (
    <header
      className="flex items-center h-12 border-b border-surface-800/50 bg-surface-900"
      style={{
        // Entire bar is a native drag region for the frameless window
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {/* ─── Left: Sidebar header area (NekoCode logo) ─── */}
      {/* Matches the old TreeSidebar header width (w-60 = 15rem) */}
      <div className="w-60 shrink-0 px-5 pt-0 pb-0 flex items-center">
        <span className="text-2xl font-display font-semibold tracking-tight">
          <span className="text-pink-400">Neko</span>
          <span className="text-white">code</span>
          <sub className="text-[9px] text-[#9CA3AF] font-normal ml-0.5">v{__APP_VERSION__}</sub>
        </span>
      </div>

      {/* ─── Center: YouTube-style search bar ─── */}
      <div
        className="flex-1 flex justify-center px-4"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div
          className="group flex items-center w-full max-w-[480px] h-8 rounded-full border border-surface-700/60 bg-surface-950/60 hover:bg-surface-900/80 hover:border-surface-600/80 focus-within:border-accent-400/50 focus-within:bg-surface-900/80 transition-colors cursor-text"
          onClick={() => window.dispatchEvent(new CustomEvent('nekocode:open-search', { detail: { mode: 'all' } }))}
          title="Search commands, files, sessions… (Ctrl+P for files, Ctrl+Shift+P for commands)"
        >
          {/* Search icon */}
          <div className="flex items-center justify-center w-10 shrink-0 text-surface-400 group-focus-within:text-accent-400/70 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          {/* Placeholder text */}
          <span className="flex-1 text-[12px] text-surface-500 select-none truncate">Search</span>
          {/* Keyboard shortcut hint */}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 mr-2 text-[10px] font-mono text-surface-500 bg-surface-800/50 rounded border border-surface-700/40">
            Ctrl P
          </kbd>
        </div>
      </div>

      {/* ─── Right: project actions + zoom controls + window controls ─── */}
      <div className="flex items-center justify-end px-2">
        {/* Project action buttons (add project + open in vscode) */}
        <div
          className="flex items-center mr-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Add Project button */}
          <button
            onClick={handleAddProject}
            className="px-2.5 py-2 text-text-secondary hover:text-text-primary hover:bg-surface-800/80 transition-colors rounded-lg"
            title="Add Project"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>

          {/* Git button — same style as Open in VS Code */}
          <button
            onClick={() => setGitOverlay(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-200 bg-surface-800/60 hover:bg-surface-700/60 border border-surface-600/30 hover:border-surface-500/40 shadow-sm shadow-surface-900/50 hover:shadow-md hover:shadow-surface-900/60 rounded-lg transition-all mr-2"
            title="Git"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 0V11a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Git</span>
          </button>

          {/* Open in VS Code split button with dropdown (Radix DropdownMenu) */}
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <div className="flex">
              {/* Main action: Open in VS Code — rounded left only */}
              <button
                onClick={async () => {
                  if (projectState.activeProjectPath) {
                    const success = await window.nekocode.shell.openInVscode(projectState.activeProjectPath)
                    if (!success) {
                      console.warn('VS Code not found on system')
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-200 bg-surface-800/60 hover:bg-surface-700/60 border border-surface-600/30 hover:border-surface-500/40 border-r-0 shadow-sm shadow-surface-900/50 hover:shadow-md hover:shadow-surface-900/60 rounded-l-lg rounded-r-none transition-all"
                title="Open Project in VS Code"
              >
                <VSCodeIcon size={14} />
                <span>Open in VS Code</span>
              </button>

              {/* Dropdown toggle: down arrow — rounded right only */}
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center px-1.5 py-1.5 text-xs font-medium text-surface-200 bg-surface-800/60 hover:bg-surface-700/60 border border-surface-600/30 hover:border-surface-500/40 shadow-sm shadow-surface-900/50 hover:shadow-md hover:shadow-surface-900/60 rounded-r-lg rounded-l-none transition-all"
                  title="More open options"
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    className={`transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
            </div>

            {/* Floating dropdown menu */}
            <DropdownMenuContent
              align="start"
              className="min-w-[180px] bg-surface-800 border-surface-600/40 rounded-lg shadow-lg shadow-surface-950/60 p-1"
            >
              {/* Open in Explorer */}
              <DropdownMenuItem
                onClick={async () => {
                  setDropdownOpen(false)
                  if (projectState.activeProjectPath) {
                    const success = await window.nekocode.shell.openInExplorer(projectState.activeProjectPath)
                    if (!success) {
                      console.warn('Failed to open in Explorer')
                    }
                  }
                }}
                className="text-xs text-text-secondary hover:text-text-primary hover:bg-surface-700/60 gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
                  <path d="M1.5 3.5v9h13v-7l-2-2h-6l-1.5-2h-2.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                </svg>
                Open in Explorer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Separator between project actions and zoom controls */}
        <div className="w-px h-5 bg-surface-700/50 mr-1" />

        {/* Zoom controls */}
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={zoomOut}
                disabled={zoom <= minZoom}
                className="px-3 py-2 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom out (Ctrl+-)"
              >
                -
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-surface-700 text-surface-100 border-surface-600">
              Zoom out (Ctrl+-)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={resetZoom}
                className="px-3 py-2 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 min-w-[48px] text-center transition-colors"
                title="Reset zoom (Ctrl+0)"
              >
                {percentage}%
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-surface-700 text-surface-100 border-surface-600">
              Reset zoom (Ctrl+0)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={zoomIn}
                disabled={zoom >= maxZoom}
                className="px-3 py-2 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom in (Ctrl+=)"
              >
                +
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-surface-700 text-surface-100 border-surface-600">
              Zoom in (Ctrl+=)
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Window control buttons */}
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Minimize */}
          <button
            onClick={handleMinimize}
            className="px-4 py-2.5 text-surface-400 hover:text-surface-100 hover:bg-surface-800/60 transition-colors"
            aria-label="Minimize"
            title="Minimize"
            type="button"
          >
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>

          {/* Maximize / Restore */}
          <button
            onClick={handleMaximize}
            className="px-4 py-2.5 text-surface-400 hover:text-surface-100 hover:bg-surface-800/60 transition-colors"
            aria-label={isMaximized ? "Restore" : "Maximize"}
            title={isMaximized ? "Restore" : "Maximize"}
            type="button"
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="0" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
                <rect x="0" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="var(--color-surface-950)" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            )}
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            className="px-4 py-2.5 text-surface-400 hover:text-white hover:bg-red-500 transition-colors"
            aria-label="Close"
            title="Close"
            type="button"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
