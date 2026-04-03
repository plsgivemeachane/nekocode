import React from 'react'
import { ProjectProvider, useProjectStore } from './stores/project-store'
import { TreeSidebar } from './components/TreeSidebar'
import { ChatView } from './components/ChatView'

function AppLayout() {
  const { state } = useProjectStore()

  return (
    <div className="flex h-screen overflow-hidden">
      <TreeSidebar />
      <ChatView sessionId={state.activeSessionId} />
    </div>
  )
}

function App() {
  return (
    <ProjectProvider>
      <AppLayout />
    </ProjectProvider>
  )
}

export default App
