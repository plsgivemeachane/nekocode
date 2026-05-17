import React, { useState, useEffect, useCallback } from 'react'
import { useZoom } from '../../hooks/useZoom'
import { useProjectStore } from '../../stores/project-store'

/**
 * Top bar spanning the full window width in frameless mode.
 * Left: NekoCode logo + version + add-project button (same Y level as before)
 * Center/Right: zoom controls + window control buttons (minimize, maximize, close)
 * The entire bar is a native drag region for the frameless window.
 */
export function NavBar() {
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
  const { addProject } = useProjectStore()
  const [isMaximized, setIsMaximized] = useState(false)
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

  return (
    <header
      className="flex items-center h-12 border-b border-surface-800/50 bg-surface-900"
      style={{
        // Entire bar is a native drag region for the frameless window
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {/* ─── Left: Sidebar header area (NekoCode logo + add button) ─── */}
      {/* Matches the old TreeSidebar header width (w-60 = 15rem) */}
      <div
        className="w-60 shrink-0 px-5 pt-0 pb-0 flex items-center justify-between"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <span className="text-2xl font-display font-semibold tracking-tight">
          <span className="text-pink-400">Neko</span>
          <span className="text-white">code</span>
          <sub className="text-[9px] text-[#9CA3AF] font-normal ml-0.5">v{__APP_VERSION__}</sub>
        </span>
        <div className="flex items-center">
          <button
            onClick={handleAddProject}
            className="px-2.5 py-2 text-text-secondary hover:text-text-primary hover:bg-surface-800/80 transition-colors"
            title="Add Project"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Center/Right: zoom controls + window controls ─── */}
      <div className="flex-1 flex items-center justify-end px-2">
        {/* Zoom controls */}
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            onClick={zoomOut}
            disabled={zoom <= minZoom}
            className="px-3 py-2 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Zoom out (Ctrl+-)"
          >
            −
          </button>
          <button
            onClick={resetZoom}
            className="px-3 py-2 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 min-w-[48px] text-center transition-colors"
            title="Reset zoom (Ctrl+0)"
          >
            {percentage}%
          </button>
          <button
            onClick={zoomIn}
            disabled={zoom >= maxZoom}
            className="px-3 py-2 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Zoom in (Ctrl+=)"
          >
            +
          </button>
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
