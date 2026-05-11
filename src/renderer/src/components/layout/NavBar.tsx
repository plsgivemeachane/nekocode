import React from 'react'
import { useZoom } from '../../hooks/useZoom'
import { useProjectStore } from '../../stores/project-store'

export function NavBar() {
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
  const { setActiveView } = useProjectStore()
  const percentage = Math.round(zoom * 100)

  return (
    <header className="h-12 flex items-center px-4 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-sm">
      <div className="flex-1" />
      
      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={zoomOut}
          disabled={zoom <= minZoom}
          className="px-2 py-1 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom out (Ctrl+-)"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="px-2 py-1 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded min-w-[48px] text-center transition-colors"
          title="Reset zoom (Ctrl+0)"
        >
          {percentage}%
        </button>
        <button
          onClick={zoomIn}
          disabled={zoom >= maxZoom}
          className="px-2 py-1 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom in (Ctrl+=)"
        >
          +
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-surface-700/50 mx-1" />

        {/* Settings button */}
        <button
          onClick={() => setActiveView('settings')}
          className="p-1 text-surface-400 hover:text-surface-100 hover:bg-surface-800/50 rounded transition-colors"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  )
}
