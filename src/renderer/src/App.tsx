import React, { useEffect } from 'react'
import { ProjectProvider, useProjectStore } from './stores/project-store'
import { TreeSidebar } from './components/layout/TreeSidebar'
import { ChatView } from './components/chat/ChatView'
import { SettingsView } from './components/settings/SettingsView'
import { NavBar } from './components/layout/NavBar'
import { createLogger } from './utils/logger'
import { soundManager } from './utils/sound-manager'

const logger = createLogger('App')

function AppLayout() {
  const { state } = useProjectStore()

  useEffect(() => {
    soundManager.init()
    return () => {
      soundManager.dispose()
    }
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-950">
      {/* NavBar doubles as titlebar in frameless mode */}
      <NavBar />
      <div className="flex flex-1 min-h-0">
        <TreeSidebar />
        {state.activeView === 'settings' ? (
          <SettingsView />
        ) : (
          <ChatView sessionId={state.activeSessionId} className="flex-1 min-w-0" />
        )}
      </div>
    </div>
  )
}

function App() {
  logger.info('App mounted')
  return (
    <ProjectProvider>
      <AppLayout />
    </ProjectProvider>
  )
}

export default App
