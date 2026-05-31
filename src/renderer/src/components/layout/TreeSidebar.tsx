import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useProjectStore, type SessionStatus } from '../../stores/project-store'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '../ui/context-menu'
import { VSCodeIcon } from '../icons/VSCodeIcon'
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
  renderSessionMenu,
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
  /** Render the context menu items for a session */
  renderSessionMenu: (sessionId: string) => React.ReactNode
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
          <ContextMenu key={session.id}>
            <ContextMenuTrigger asChild>
              <div
                className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer rounded-lg transition-colors duration-150 text-[13px] border ${
                  isActiveSession
                    ? 'bg-surface-800/80 text-text-primary border-surface-600'
                    : 'text-text-secondary/80 border-transparent hover:bg-surface-800/60 hover:text-text-primary hover:border-surface-600'
                } ${isPending ? 'opacity-60 cursor-wait' : ''}`}
                onClick={() => handleSessionClick(session.id)}
                onMouseEnter={() => !isPending && onHoverSession(session.id)}
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
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-[180px] bg-surface-900/95 backdrop-blur-md border-surface-700/60 shadow-xl shadow-black/40">
              {renderSessionMenu(session.id)}
            </ContextMenuContent>
          </ContextMenu>
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

  // Shell operation UX state: loading indicator, toast for failure feedback, debounce
  const [shellOpening, setShellOpening] = useState<string | null>(null) // 'vscode' | 'explorer' | null
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null)
  const lastShellCallRef = useRef<number>(0)
  // Track VS Code availability so the button can be properly disabled/hidden
  const [vscodeAvailable, setVscodeAvailable] = useState<boolean>(true) // Assume available (URI scheme)

  // Check VS Code availability on mount
  useEffect(() => {
    window.nekocode.shell.checkVscodeAvailable().then((result) => {
      setVscodeAvailable(result.available)
    }).catch(() => {
      // If check fails, assume available (URI scheme may still work)
      setVscodeAvailable(true)
    })
  }, [])

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  // Debounced shell operation handler — prevents rapid clicks from spawning multiple commands
  const handleShellOpen = useCallback(async (type: 'vscode' | 'explorer', projectPath: string) => {
    const now = Date.now()
    if (now - lastShellCallRef.current < 1000) {
      logger.debug(`Debounced shell ${type} call`)
      return
    }
    lastShellCallRef.current = now

    setShellOpening(type)
    try {
      let success: boolean
      if (type === 'vscode') {
        success = await window.nekocode.shell.openInVscode(projectPath)
      } else {
        success = await window.nekocode.shell.openInExplorer(projectPath)
      }
      if (!success) {
        setToast({ message: type === 'vscode' ? 'Failed to open VS Code. Is it installed?' : 'Failed to open file explorer.', type: 'error' })
      }
    } catch (err) {
      logger.error(`Failed to open ${type}:`, err)
      setToast({ message: `Error opening ${type === 'vscode' ? 'VS Code' : 'explorer'}.`, type: 'error' })
    } finally {
      setShellOpening(null)
    }
  }, [])

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

  // NotificationSettingsPanel moved to central Settings page

  // Render project context menu items (Radix shadcn)
  const renderProjectMenu = useCallback((project: { id: string; path: string }) => (
    <>
      <ContextMenuItem
        className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
        onClick={() => createSession(project.path)}
      >
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        New Session
      </ContextMenuItem>
      <ContextMenuItem
        className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
        onClick={() => refreshSessions(project.id)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Refresh Sessions
      </ContextMenuItem>
      <ContextMenuItem
        className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
        disabled={shellOpening === 'explorer'}
        onClick={() => handleShellOpen('explorer', project.path)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 3.5v9h13v-7l-2-2h-6l-1.5-2h-2.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
        Open in Explorer
      </ContextMenuItem>
      <ContextMenuItem
        className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
        disabled={!vscodeAvailable || shellOpening === 'vscode'}
        onClick={() => handleShellOpen('vscode', project.path)}
      >
        <VSCodeIcon size={13} />
        {shellOpening === 'vscode' ? 'Opening VS Code...' : 'Open in VS Code'}
      </ContextMenuItem>
      <ContextMenuSeparator className="my-1 mx-2 bg-surface-700/60" />
      <ContextMenuItem
        variant="destructive"
        className="text-[12px] gap-2.5"
        onClick={() => removeProject(project.id)}
      >
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        Remove Project
      </ContextMenuItem>
    </>
  ), [createSession, refreshSessions, removeProject, handleShellOpen, vscodeAvailable, shellOpening])

  // Render session context menu items (Radix shadcn)
  const renderSessionMenu = useCallback((sessionId: string, projectPath: string, projectId: string) => {
    const isSessionStreaming = state.sessionStatuses[sessionId] === 'streaming'
    return (
      <>
        <ContextMenuItem
          className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
          disabled={isSessionStreaming}
          onClick={() => refreshSessionMessages(sessionId)}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Refresh Messages
          {isSessionStreaming && <ContextMenuShortcut className="text-[10px] text-text-tertiary/50">Running...</ContextMenuShortcut>}
        </ContextMenuItem>
        <ContextMenuSeparator className="my-1 mx-2 bg-surface-700/60" />
        <ContextMenuItem
          className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
          onClick={() => navigator.clipboard.writeText(sessionId)}
        >
          Copy Session ID
        </ContextMenuItem>
        <ContextMenuSeparator className="my-1 mx-2 bg-surface-700/60" />
        <ContextMenuItem
          className="text-text-secondary hover:text-text-primary hover:bg-surface-800/60 text-[12px] gap-2.5"
          disabled={!vscodeAvailable || shellOpening === 'vscode'}
          onClick={() => handleShellOpen('vscode', projectPath)}
        >
          <VSCodeIcon size={13} />
          Open Project in VS Code
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          className="text-[12px] gap-2.5"
          onClick={async () => {
            try {
              await window.nekocode.session.deleteSession(sessionId, projectPath)
              await refreshSessions(projectId)
              if (activeSessionId === sessionId) {
                setActiveSession('', '')
              }
            } catch (err) {
              logger.error('Failed to delete session:', err)
            }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 3.5h8M4.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M9 3.5v6a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Delete Session
        </ContextMenuItem>
      </>
    )
  }, [activeSessionId, refreshSessions, setActiveSession, refreshSessionMessages, state.sessionStatuses, vscodeAvailable, shellOpening, handleShellOpen])

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
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className={`group flex items-center gap-2 px-2.5 py-[7px] cursor-pointer rounded-lg transition-colors duration-150 border ${
                      isActive ? 'bg-surface-800/80 border-surface-600' : 'border-transparent hover:bg-surface-800/60 hover:border-surface-600'
                    }`}
                    onClick={() => toggleExpand(project.id)}
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
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px] bg-surface-900/95 backdrop-blur-md border-surface-700/60 shadow-xl shadow-black/40">
                  {renderProjectMenu(project)}
                </ContextMenuContent>
              </ContextMenu>

              {/* Sessions */}
              {isExpanded && (
                <SessionList
                  sessions={project.sessions}
                  activeSessionId={state.activeSessionId}
                  sessionStatuses={state.sessionStatuses}
                  sessionErrorMessages={state.sessionErrorMessages}
                  onReconnect={(sessionId) => reconnectSession(sessionId, project.path)}
                  onHoverSession={(sessionId) => preloadSession(sessionId, project.path)}
                  renderSessionMenu={(sessionId) => renderSessionMenu(sessionId, project.path, project.id)}
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
        {/* Settings button */}
        <button
          onClick={() => setActiveView('settings')}
          className={`w-full flex items-center gap-2 px-2.5 py-[7px] ${state.activeView === 'settings' ? 'text-accent bg-accent/10 border-accent/20' : 'text-text-secondary hover:text-text-primary hover:bg-surface-800/80 border-transparent hover:border-surface-600'} rounded-lg border transition-colors duration-200`}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="text-[13px] font-medium">Settings</span>
        </button>
      </div>

      {/* Toast notification for shell operation failures */}
      {toast && (
        <div className={`absolute bottom-4 left-3 right-3 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-300 ${
          toast.type === 'error'
            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
            : 'bg-green-500/20 text-green-400 border border-green-500/30'
        }`}>
          {toast.message}
        </div>
      )}

      {/* NotificationSettingsPanel moved to central Settings page */}
    </aside>
  )
}
