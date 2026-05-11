import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { NotificationSettingsContent } from '../ui/NotificationSettingsContent'
import { useZoom } from '../../hooks/useZoom'

export function SettingsView() {
  const { setActiveView } = useProjectStore()
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
  const percentage = Math.round(zoom * 100)

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-surface-950">
      {/* Header */}
      <header className="h-12 flex items-center px-6 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-sm">
        <button
          onClick={() => setActiveView('chat')}
          className="p-1.5 text-surface-400 hover:text-surface-100 hover:bg-surface-800/50 rounded transition-colors"
          title="Back to chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="ml-3 text-sm font-medium text-surface-100">Settings</h1>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

          {/* --- Notifications Section --- */}
          <section>
            <h2 className="text-lg font-semibold text-surface-100 mb-4">Notifications</h2>
            <NotificationSettingsContent />
          </section>

          {/* --- Appearance Section --- */}
          <section>
            <h2 className="text-lg font-semibold text-surface-100 mb-4">Appearance</h2>
            <div className="bg-surface-900/60 rounded-lg border border-surface-800/50 p-4 space-y-4">
              {/* Zoom */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-surface-200">Zoom</p>
                  <p className="text-xs text-surface-500">Adjust the interface scale ({Math.round(minZoom * 100)}% &ndash; {Math.round(maxZoom * 100)}%)</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={zoomOut}
                    disabled={zoom <= minZoom}
                    className="px-3 py-1.5 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Zoom out"
                  >
                    &minus;
                  </button>
                  <button
                    onClick={resetZoom}
                    className="px-2 py-1.5 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded min-w-[48px] text-center transition-colors"
                    title="Reset zoom"
                  >
                    {percentage}%
                  </button>
                  <button
                    onClick={zoomIn}
                    disabled={zoom >= maxZoom}
                    className="px-3 py-1.5 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Zoom in"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* --- About Section --- */}
          <section>
            <h2 className="text-lg font-semibold text-surface-100 mb-4">About</h2>
            <div className="bg-surface-900/60 rounded-lg border border-surface-800/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-surface-200">Application</p>
                <p className="text-sm text-surface-400">NekoCode</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-surface-200">Version</p>
                <p className="text-sm text-surface-400">0.2.x</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-surface-200">Engine</p>
                <p className="text-sm text-surface-400">Pi SDK</p>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
