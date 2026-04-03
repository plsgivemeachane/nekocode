import { useState, useEffect } from 'react'
import { useProjectStore, type SessionStatus } from '../stores/project-store'

function folderName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '\u2026' : str
}

function StatusDot({ status }: { status: SessionStatus }) {
  const color =
    status === 'streaming'
      ? 'bg-blue-400 animate-pulse'
      : status === 'error'
        ? 'bg-red-400'
        : 'bg-zinc-600'
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} />
}

export function TreeSidebar() {
  const { state, addProject, removeProject, setActiveSession, createSession } =
    useProjectStore()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Auto-expand newly added projects
  const prevIds = useState(new Set<string>())[0]
  useEffect(() => {
    const currentIds = new Set(state.projects.map(p => p.id))
    const newIds = [...currentIds].filter(id => !prevIds.has(id))
    if (newIds.length > 0) {
      setExpanded(prev => {
        const next = new Set(prev)
        newIds.forEach(id => next.add(id))
        return next
      })
    }
    prevIds.clear()
    currentIds.forEach(id => prevIds.add(id))
  }, [state.projects, prevIds])

  const toggleExpand = (projectId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const handleAddProject = async () => {
    const folder = await window.nekocode.dialog.openFolder()
    if (folder) {
      await addProject(folder)
    }
  }

  const handleRemove = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    await removeProject(projectId)
  }

  return (
    <aside className="w-60 bg-gray-900 h-screen flex flex-col border-r border-zinc-800 shrink-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
        <span className="text-sm font-semibold text-zinc-100 tracking-tight">NekoCode</span>
        <button
          onClick={handleAddProject}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          title="Add Project"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-1">
        {state.projects.length === 0 && (
          <p className="text-xs text-zinc-600 px-4 py-6 text-center">
            No projects yet.
            <br />
            Click + to add one.
          </p>
        )}

        {state.projects.map(project => {
          const isExpanded = expanded.has(project.id)
          const isActive = state.activeProjectPath === project.path

          return (
            <div key={project.id}>
              {/* Project row */}
              <div
                className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors ${
                  isActive ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                }`}
                onClick={() => toggleExpand(project.id)}
              >
                {/* Chevron */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={`text-zinc-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                >
                  <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>

                {/* Folder icon */}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-zinc-400 shrink-0">
                  <path d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3.17L8 3.5h5c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-9.5z" stroke="currentColor" strokeWidth="1.2" />
                </svg>

                {/* Name */}
                <span className="text-sm text-zinc-300 truncate flex-1">
                  {folderName(project.path)}
                </span>

                {/* Remove button */}
                <button
                  onClick={(e) => handleRemove(e, project.id)}
                  className="p-0.5 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove Project"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* Expanded: sessions */}
              {isExpanded && (
                <div className="ml-5 border-l border-zinc-800">
                  {project.sessions.map(session => {
                    const isActiveSession = state.activeSessionId === session.id
                    const status = state.sessionStatuses[session.id] ?? 'idle'

                    return (
                      <div
                        key={session.id}
                        className={`flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors text-sm ${
                          isActiveSession
                            ? 'bg-zinc-800 text-zinc-100 border-l-2 border-l-blue-500 -ml-px'
                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                        }`}
                        onClick={() => setActiveSession(session.id, project.path)}
                      >
                        {/* Session icon */}
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
                          <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                          <path d="M5 6h6M5 8.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                        </svg>

                        <span className="truncate flex-1">
                          {session.firstMessage ? truncate(session.firstMessage, 24) : 'Untitled'}
                        </span>

                        <StatusDot status={status} />
                      </div>
                    )
                  })}

                  {/* New Session button */}
                  <button
                    onClick={() => createSession(project.path)}
                    className="flex items-center gap-2 px-3 py-1 w-full text-left text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
                      <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    New Session
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
