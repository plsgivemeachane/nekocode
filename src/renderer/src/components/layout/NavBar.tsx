import React from 'react'
import { useZoom } from '../../hooks/useZoom'

export function NavBar() {
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
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
      </div>
    </header>
  )
}
