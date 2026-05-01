import React, { useState, useEffect, useCallback } from 'react'
import { useProjectStore, type SessionStatus } from '../../stores/project-store'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { createLogger } from '../../utils/logger'

const logger = createLogger('TreeSidebar')

function folderName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '\u2026' : str
}

function StatusDot({ status }: { status: SessionStatus }) {
  if (status === 'idle') return null
  const color =
    status === 'streaming'
      ? 'bg-accent-400 animate-glow-pulse'
      : 'bg-error'
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
}

const VISIBLE_SESSIONS = 6

function SessionList({
  sessions,
  activeSessionId,
  sessionStatuses,
  onReconnect,
  onHoverSession,
  onContextMenu,
  onCreateSession,
}: {
  sessions: { id: string; firstMessage?: string }[]
  activeSessionId: string | null
  sessionStatuses: Record<string, SessionStatus>
  onReconnect: (sessionId: string) => void
  onHoverSession: (sessionId: string) => void
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
  onCreateSession: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const hasMore = sessions.length > VISIBLE_SESSIONS
  const visibleSessions = showAll ? sessions : sessions.slice(0, VISIBLE_SESSIONS)

  const handleSessionClick = (sessionId: string) => {
    // Ignore clicks on pending sessions (optimistic UI placeholders)
    if (sessionId.startsWith('pending-')) {
      return
    }
    onReconnect(sessionId)
    // Notify ChatView so the prompt input can be focused even when re-selecting the current session.
    window.dispatchEvent(new Event('nekocode:session-selected'))
  }

  return (
    <div className="ml-3 mt-0.5 space-y-px">
      {/* New Session — at the top */}
      <button
        onClick={onCreateSession}
        className="flex items-center gap-2 px-2.5 py-1.5 w-full text-left text-[12px] text-text-tertiary/80 hover:text-text-primary hover:bg-surface-800/70 rounded-lg border border-transparent hover:border-surface-600 transition-colors duration-150 pl-5"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0">
          <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        New Session
      </button>

      {visibleSessions.map(session => {
        const isActiveSession = activeSessionId === session.id
        const status = sessionStatuses[session.id] ?? 'idle'
        const isPending = session.id.startsWith('pending-')

        return (
          <div
            key={session.id}
            className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer rounded-lg transition-colors duration-150 text-[13px] border ${
              isActiveSession
                ? 'bg-surface-800/80 text-text-primary border-surface-600'
                : 'text-text-secondary/80 border-transparent hover:bg-surface-800/60 hover:text-text-primary hover:border-surface-600'
            } ${isPending ? 'opacity-60 cursor-wait' : ''}`}
            onClick={() => handleSessionClick(session.id)}
            onMouseEnter={() => !isPending && onHoverSession(session.id)}
            onContextMenu={(e) => onContextMenu(e, session.id)}
          >
            <span className={`truncate flex-1 ${isActiveSession ? '' : 'pl-3'}`}>
              {session.firstMessage ? truncate(session.firstMessage, 26) : 'Untitled'}
            </span>

            {isPending ? (
              <svg className="animate-spin w-3 h-3 text-text-tertiary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <StatusDot status={status} />
            )}
          </div>
        )
      })}

      {hasMore && (
        <button
          onClick={() => setShowAll(prev => !prev)}
          className="flex items-center gap-2 px-2.5 py-[6px] w-full text-left text-[12px] text-text-tertiary/80 hover:text-text-primary hover:bg-surface-800/60 rounded-lg border border-transparent hover:border-surface-600 transition-colors duration-150 pl-5"
        >
          {showAll ? 'Show less' : `Show more (${sessions.length - VISIBLE_SESSIONS})`}
        </button>
      )}
    </div>
  )
}

export function TreeSidebar() {
  const { state, addProject, removeProject, reconnectSession, createSession, refreshSessions, preloadSession, setActiveSession } =
    useProjectStore()
  const activeSessionId = state.activeSessionId

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
      logger.info(`add project: ${folder}`)
      await addProject(folder)
    }
  }

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const openProjectMenu = useCallback((e: React.MouseEvent, project: { id: string; path: string }) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'New Session',
          icon: <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
          onClick: () => createSession(project.path),
        },
        {
          label: 'Refresh Sessions',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
          onClick: () => refreshSessions(project.id),
        },
        {
          label: 'Open in Explorer',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 3.5v9h13v-7l-2-2h-6l-1.5-2h-2.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>,
          onClick: () => {
            // Use Electron shell to open folder
            window.nekocode.dialog.openFolder?.()
          },
          disabled: true,
        },
        { type: 'separator' },
        {
          label: 'Remove Project',
          icon: <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
          onClick: () => removeProject(project.id),
          danger: true,
        },
      ],
    })
  }, [createSession, refreshSessions, removeProject])

  const openSessionMenu = useCallback((e: React.MouseEvent, sessionId: string, projectPath: string, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Copy Session ID',
          onClick: () => navigator.clipboard.writeText(sessionId),
        },
        { type: 'separator' },
        {
          label: 'Delete Session',
          icon: <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 3.5h8M4.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M9 3.5v6a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>,
          onClick: async () => {
            try {
              await window.nekocode.session.deleteSession(sessionId, projectPath)
              await refreshSessions(projectId)
              if (activeSessionId === sessionId) {
                setActiveSession('', '')
              }
            } catch (err) {
              logger.error('Failed to delete session:', err)
            }
          },
          danger: true,
        },
      ],
    })
  }, [activeSessionId, refreshSessions, setActiveSession])

  return (
    <aside className="w-60 bg-surface-900 h-screen flex flex-col shrink-0 text-text-primary shadow-[inset_-1px_0_0_rgba(255,255,255,0.06)]">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <span className="text-2xl font-display font-semibold tracking-tight"><span className="text-pink-400">Neko</span><span className="text-white">code</span></span>
          <button
            onClick={handleAddProject}
            className="p-1 text-text-secondary hover:text-text-primary hover:bg-surface-800/80 rounded-md border border-transparent hover:border-surface-600 transition-colors duration-200"
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
          <p className="text-[11px] text-text-tertiary/80 px-3 py-10 text-center leading-relaxed">
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
                className={`group flex items-center gap-2 px-2.5 py-[7px] cursor-pointer rounded-lg transition-colors duration-150 border ${
                  isActive ? 'bg-surface-800/80 border-surface-600' : 'border-transparent hover:bg-surface-800/60 hover:border-surface-600'
                }`}
                onClick={() => toggleExpand(project.id)}
                onContextMenu={(e) => openProjectMenu(e, project)}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={`text-text-tertiary shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                >
                  <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>

                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-tertiary/80 shrink-0">
                  <path d="M2 3.5C2 2.67 2.67 2 3.5 2h3L8 3.5h4.5c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-9.5z" stroke="currentColor" strokeWidth="1" />
                </svg>

                <span className={`text-[13px] truncate flex-1 font-medium ${isActive ? 'text-text-primary' : 'text-text-secondary/90'}`}>
                  {folderName(project.path)}
                </span>


              </div>

              {/* Sessions */}
              {isExpanded && (
                <SessionList
                  sessions={project.sessions}
                  activeSessionId={state.activeSessionId}
                  sessionStatuses={state.sessionStatuses}
                  onReconnect={(sessionId) => reconnectSession(sessionId, project.path)}
                  onHoverSession={(sessionId) => preloadSession(sessionId, project.path)}
                  onContextMenu={(e, sessionId) => openSessionMenu(e, sessionId, project.path, project.id)}
                  onCreateSession={() => createSession(project.path)}
                />
              )}
            </div>
          )
        })}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={closeCtxMenu}
        />
      )}
    </aside>
  )
}
