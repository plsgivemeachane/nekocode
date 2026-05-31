import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { NotificationSettingsContent } from '../ui/NotificationSettingsContent'
import { Label } from '../ui/label'
import { useZoom } from '../../hooks/useZoom'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/tabs'

export function SettingsView() {
  const { setActiveView } = useProjectStore()
  const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom()
  const percentage = Math.round(zoom * 100)

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface-950">
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

      {/* Tabbed settings content */}
      <Tabs defaultValue="notifications" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none border-b border-surface-800/50 bg-surface-950/50 px-6 h-9">
          <TabsTrigger
            value="notifications"
            className="text-xs text-text-secondary data-[state=active]:text-accent-400 data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-accent-400 rounded-none px-3 py-1.5"
          >
            Notifications
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="text-xs text-text-secondary data-[state=active]:text-accent-400 data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-accent-400 rounded-none px-3 py-1.5"
          >
            Appearance
          </TabsTrigger>
          <TabsTrigger
            value="about"
            className="text-xs text-text-secondary data-[state=active]:text-accent-400 data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-accent-400 rounded-none px-3 py-1.5"
          >
            About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="flex-1 overflow-y-auto mt-0">
          <div className="max-w-2xl mx-auto px-6 py-8">
            <NotificationSettingsContent />
          </div>
        </TabsContent>

        <TabsContent value="appearance" className="flex-1 overflow-y-auto mt-0">
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            {/* Zoom */}
            <div className="bg-surface-900/60 rounded-lg border border-surface-800/50 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm text-surface-200">Zoom</Label>
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
          </div>
        </TabsContent>

        <TabsContent value="about" className="flex-1 overflow-y-auto mt-0">
          <div className="max-w-2xl mx-auto px-6 py-8">
            <div className="bg-surface-900/60 rounded-lg border border-surface-800/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-surface-200">Application</Label>
                <p className="text-sm text-surface-400">NekoCode</p>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm text-surface-200">Version</Label>
                <p className="text-sm text-surface-400">0.2.x</p>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm text-surface-200">Engine</Label>
                <p className="text-sm text-surface-400">Pi SDK</p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
