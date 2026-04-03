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
      ? 'bg-accent-400 animate-glow-pulse'
      : status === 'error'
        ? 'bg-error'
        : 'bg-surface-600'
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
}

export function TreeSidebar() {
  const { state, addProject, removeProject, reconnectSession, createSession } =
    useProjectStore()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
    <aside className="w-60 bg-surface-950 h-screen flex flex-col shrink-0">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-display font-medium text-text-secondary tracking-tight">NekoCode</span>
          <button
            onClick={handleAddProject}
            className="p-1 text-text-tertiary hover:text-text-secondary hover:bg-surface-800/60 rounded-md transition-colors duration-200"
            title="Add Project"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2">
        {state.projects.length === 0 && (
          <p className="text-[11px] text-text-tertiary/60 px-3 py-10 text-center leading-relaxed">
            No projects yet.
            <br />
            Click + to add one.
          </p>
        )}

        {state.projects.map(project => {
          const isExpanded = expanded.has(project.id)
          const isActive = state.activeProjectPath === project.path

          return (
            <div key={project.id} className="mb-0.5">
              {/* Project row */}
              <div
                className={`group flex items-center gap-2 px-2.5 py-[7px] cursor-pointer rounded-lg transition-colors duration-150 ${
                  isActive ? 'bg-surface-800/70' : 'hover:bg-surface-800/40'
                }`}
                onClick={() => toggleExpand(project.id)}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={`text-text-tertiary/70 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                >
                  <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>

                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-tertiary shrink-0">
                  <path d="M2 3.5C2 2.67 2.67 2 3.5 2h3L8 3.5h4.5c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-9.5z" stroke="currentColor" strokeWidth="1" />
                </svg>

                <span className={`text-[13px] truncate flex-1 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>
                  {folderName(project.path)}
                </span>

                <button
                  onClick={(e) => handleRemove(e, project.id)}
                  className="p-0.5 text-text-tertiary/50 hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-all duration-150"
                  title="Remove Project"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* Sessions */}
              {isExpanded && (
                <div className="ml-3 mt-0.5 space-y-px">
                  {project.sessions.map(session => {
                    const isActiveSession = state.activeSessionId === session.id
                    const status = state.sessionStatuses[session.id] ?? 'idle'

                    return (
                      <div
                        key={session.id}
                        className={`flex items-center gap-2 px-2.5 py-[6px] cursor-pointer rounded-lg transition-colors duration-150 text-[13px] ${
                          isActiveSession
                            ? 'bg-accent-500/10 text-text-primary'
                            : 'text-text-tertiary hover:bg-surface-800/30 hover:text-text-secondary'
                        }`}
                        onClick={() => reconnectSession(session.id, project.path)}
                      >
                        <span className={`truncate flex-1 ${isActiveSession ? '' : 'pl-3'}`}>
                          {session.firstMessage ? truncate(session.firstMessage, 26) : 'Untitled'}
                        </span>

                        <StatusDot status={status} />
                      </div>
                    )
                  })}

                  {/* New Session */}
                  <button
                    onClick={() => createSession(project.path)}
                    className="flex items-center gap-2 px-2.5 py-[6px] w-full text-left text-[12px] text-text-tertiary/50 hover:text-text-secondary hover:bg-surface-800/30 rounded-lg transition-colors duration-150 pl-5"
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0">
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
