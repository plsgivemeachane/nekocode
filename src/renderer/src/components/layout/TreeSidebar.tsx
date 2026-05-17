import React, { useState, useEffect, useCallback } from 'react'
import { useProjectStore, type SessionStatus } from '../../stores/project-store'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
// NotificationSettingsPanel is now in SettingsView
import { createLogger } from '../../utils/logger'

const logger = createLogger('TreeSidebar')

function folderName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '\u2026' : str
}

function StatusDot({ status, errorMessage }: { status: SessionStatus; errorMessage?: string }) {
  if (status === 'idle') return null
  const color =
    status === 'streaming'
      ? 'bg-accent-400 animate-glow-pulse'
      : 'bg-error'
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`} title={status === 'error' && errorMessage ? errorMessage : undefined} />
}

const VISIBLE_SESSIONS = 6

function SessionList({
  sessions,
  activeSessionId,
  sessionStatuses,
  sessionErrorMessages,
  isAgentConnecting,
  onReconnect,
  onHoverSession,
  onContextMenu,
  onCreateSession,
}: {
  sessions: { id: string; firstMessage?: string }[]
  activeSessionId: string | null
  sessionStatuses: Record<string, SessionStatus>
  sessionErrorMessages: Record<string, string>
  /** Whether the agent for the active session is still connecting */
  isAgentConnecting: boolean
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

            {(isPending || (isActiveSession && isAgentConnecting)) ? (
              <svg className="animate-spin w-3 h-3 text-text-tertiary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <StatusDot status={status} errorMessage={sessionErrorMessages[session.id]} />
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
  const { state, removeProject, reconnectSession, createSession, refreshSessions, refreshSessionMessages, preloadSession, setActiveSession, setActiveView } =
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

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])
  // NotificationSettingsPanel moved to central Settings page

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
    // Check if this session is currently streaming (blue dot)
    const isSessionStreaming = state.sessionStatuses[sessionId] === 'streaming'
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Refresh Messages',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
          onClick: () => refreshSessionMessages(sessionId),
          disabled: isSessionStreaming,
          shortcut: isSessionStreaming ? 'Running...' : undefined,
        },
        { type: 'separator' },
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
  }, [activeSessionId, refreshSessions, setActiveSession, refreshSessionMessages, state.sessionStatuses])

  return (
    <aside className="w-60 bg-surface-900 h-full flex flex-col shrink-0 text-text-primary shadow-[inset_-1px_0_0_rgba(255,255,255,0.06)]">
      {/* Header moved to NavBar (same row as window controls) */}

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
                  sessionErrorMessages={state.sessionErrorMessages}
                  onReconnect={(sessionId) => reconnectSession(sessionId, project.path)}
                  onHoverSession={(sessionId) => preloadSession(sessionId, project.path)}
                  onContextMenu={(e, sessionId) => openSessionMenu(e, sessionId, project.path, project.id)}
                  onCreateSession={() => createSession(project.path)}
                  isAgentConnecting={!state.agentReady && state.activeSessionId != null}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Settings button at sidebar bottom */}
      <div className="px-3 py-3 border-t border-surface-800/50">
        <button
          onClick={() => setActiveView('settings')}
          className="w-full flex items-center gap-2 px-2.5 py-[7px] text-text-secondary hover:text-text-primary hover:bg-surface-800/80 rounded-lg border border-transparent hover:border-surface-600 transition-colors duration-200"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="text-[13px] font-medium">Settings</span>
        </button>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={closeCtxMenu}
        />
      )}

      {/* NotificationSettingsPanel moved to central Settings page */}
    </aside>
  )
}
