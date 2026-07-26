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
      // ─── OpenCode TUI title bar ────────────────────────────────────
      // Pitch-black, sharp corners, thin terminal-border bottom divider.
      // Monospace logo. All buttons are sharp rectangles.
      className="flex items-center h-12 border-b border-terminal-border bg-terminal-bg font-mono"
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

      {/* ─── Center: YouTube-style search bar — sharp rectangle, terminal panel ─── */}
      <div
        className="flex-1 flex justify-center px-4"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div
          className="group flex items-center w-full max-w-[480px] h-8 rounded-none border border-terminal-border bg-terminal-panel hover:border-terminal-border-bright focus-within:border-accent-400/50 focus-within:bg-terminal-panel transition-colors cursor-text"
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
          {/* Keyboard shortcut hint — sharp rectangle kbd */}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 mr-2 text-[10px] font-mono text-surface-500 bg-terminal-bg rounded-none border border-terminal-border">
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
          {/* Add Project button — sharp rectangle, monospace */}
          <button
            onClick={handleAddProject}
            className="px-2.5 py-2 text-text-secondary hover:text-text-primary hover:bg-terminal-panel transition-colors rounded-none font-mono"
            title="Add Project"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>

          {/* Git button — sharp rectangle, terminal panel */}
          <button
            onClick={() => setGitOverlay(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono text-surface-200 bg-terminal-panel hover:bg-surface-900 border border-terminal-border hover:border-terminal-border-bright transition-all mr-2 rounded-none"
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
              {/* Main action: Open in VS Code — sharp left edge */}
              <button
                onClick={async () => {
                  if (projectState.activeProjectPath) {
                    const success = await window.nekocode.shell.openInVscode(projectState.activeProjectPath)
                    if (!success) {
                      console.warn('VS Code not found on system')
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono text-surface-200 bg-terminal-panel hover:bg-surface-900 border border-terminal-border hover:border-terminal-border-bright border-r-0 transition-all rounded-none"
                title="Open Project in VS Code"
              >
                <VSCodeIcon size={14} />
                <span>Open in VS Code</span>
              </button>

              {/* Dropdown toggle: down arrow — sharp right edge */}
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center px-1.5 py-1.5 text-xs font-medium font-mono text-surface-200 bg-terminal-panel hover:bg-surface-900 border border-terminal-border hover:border-terminal-border-bright transition-all rounded-none"
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

            {/* Floating dropdown menu — sharp rectangle, terminal panel */}
            <DropdownMenuContent
              align="start"
              className="min-w-[180px] bg-terminal-panel border-terminal-border rounded-none shadow-lg shadow-black/60 p-1"
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
                className="text-xs font-mono text-text-secondary hover:text-text-primary hover:bg-surface-900 gap-2 rounded-none"
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
        <div className="w-px h-5 bg-terminal-border mr-1" />

        {/* Zoom controls — sharp rectangles, monospace */}
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={zoomOut}
                disabled={zoom <= minZoom}
                className="px-3 py-2 text-sm font-mono text-surface-300 hover:text-surface-100 hover:bg-terminal-panel disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-none"
                title="Zoom out (Ctrl+-)"
              >
                -
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-terminal-panel text-surface-100 border-terminal-border rounded-none">
              Zoom out (Ctrl+-)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={resetZoom}
                className="px-3 py-2 text-sm font-mono text-surface-300 hover:text-surface-100 hover:bg-terminal-panel min-w-[48px] text-center transition-colors rounded-none"
                title="Reset zoom (Ctrl+0)"
              >
                {percentage}%
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-terminal-panel text-surface-100 border-terminal-border rounded-none">
              Reset zoom (Ctrl+0)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={zoomIn}
                disabled={zoom >= maxZoom}
                className="px-3 py-2 text-sm font-mono text-surface-300 hover:text-surface-100 hover:bg-terminal-panel disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-none"
                title="Zoom in (Ctrl+=)"
              >
                +
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-terminal-panel text-surface-100 border-terminal-border rounded-none">
              Zoom in (Ctrl+=)
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Window control buttons — sharp rectangles */}
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Minimize */}
          <button
            onClick={handleMinimize}
            className="px-4 py-2.5 text-surface-400 hover:text-surface-100 hover:bg-terminal-panel transition-colors rounded-none"
            aria-label="Minimize"
            title="Minimize"
            type="button"
          >
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>

          {/* Maximize / Restore — sharp rectangles (rx=0) */}
          <button
            onClick={handleMaximize}
            className="px-4 py-2.5 text-surface-400 hover:text-surface-100 hover:bg-terminal-panel transition-colors rounded-none"
            aria-label={isMaximized ? "Restore" : "Maximize"}
            title={isMaximized ? "Restore" : "Maximize"}
            type="button"
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="0" width="8" height="8" rx="0" stroke="currentColor" strokeWidth="1" fill="none" />
                <rect x="0" y="2" width="8" height="8" rx="0" stroke="currentColor" strokeWidth="1" fill="var(--color-terminal-bg)" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="9" height="9" rx="0" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            )}
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            className="px-4 py-2.5 text-surface-400 hover:text-white hover:bg-error transition-colors rounded-none"
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
