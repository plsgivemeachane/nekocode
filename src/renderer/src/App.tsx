import React, { useEffect } from 'react'
import { ProjectProvider, useProjectStore } from './stores/project-store'
import { SessionMessagesProvider } from './contexts/session-messages-context'
import { TreeSidebar } from './components/layout/TreeSidebar'
import { RightSidebar } from './components/layout/RightSidebar'
import { ChatView } from './components/chat/ChatView'
import { SettingsView } from './components/settings/SettingsView'
import { GitCommandCenter } from './components/git/GitCommandCenter'
import { NavBar } from './components/layout/NavBar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog'
import { createLogger } from './utils/logger'
import { soundManager } from './utils/sound-manager'
import { TooltipProvider } from './components/ui/tooltip'

const logger = createLogger('App')

function AppLayout() {
  const { state, setGitOverlay } = useProjectStore()

  useEffect(() => {
    soundManager.init()
    return () => {
      soundManager.dispose()
    }
  }, [])

  // Escape key handling is now managed by Radix Dialog

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-950">
      {/* NavBar doubles as titlebar in frameless mode */}
      <NavBar />
      {/* Main content area: [LeftSidebar] [ContentGroup] [RightSidebar] */}
      <div className="flex flex-1 min-h-0">
        <TreeSidebar />
        {/* Content group: messages + input (prepared for future split-screen) */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {state.activeView === 'settings' ? (
            <SettingsView />
          ) : (
            <ChatView sessionId={state.activeSessionId} className="flex-1 min-w-0" />
          )}
        </div>
        {/* Right sidebar: full-height, like the left sidebar */}
        <RightSidebar />
      </div>

      {/* Git overlay modal — full-screen with blur backdrop, using Radix Dialog for accessibility */}
      <Dialog open={state.showGitOverlay} onOpenChange={(open) => { if (!open) setGitOverlay(false) }}>
        <DialogContent
          showCloseButton={false}
          className="w-[calc(100vw-80px)] h-[calc(100vh-80px)] max-w-[1400px] rounded-2xl bg-surface-900 border border-surface-700/50 shadow-2xl shadow-surface-950/80 overflow-hidden flex flex-col p-0 gap-0"
          overlayClassName="bg-surface-950/70 backdrop-blur-md"
        >
          {/* Modal header */}
          <DialogHeader className="flex-row items-center justify-between px-5 py-3 border-b border-surface-800/50 bg-surface-900/80 space-y-0">
            <div className="flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-accent">
                <path d="M6 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 0V11a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <DialogTitle className="text-sm font-semibold text-text-primary">Git</DialogTitle>
            </div>
          </DialogHeader>

          {/* Git content */}
          <div className="flex-1 overflow-hidden">
            <GitCommandCenter />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function App() {
  logger.info('App mounted')
  return (
    <TooltipProvider delayDuration={400}>
      <ProjectProvider>
        <SessionMessagesProvider>
          <AppLayout />
        </SessionMessagesProvider>
      </ProjectProvider>
    </TooltipProvider>
  )
}

export default App
