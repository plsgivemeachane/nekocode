import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import type {
  ProjectInfo,
  SessionInfoDisplay,
} from '../../../shared/ipc-types'
import { createLogger } from '../logger'

const logger = createLogger('project-store')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = 'idle' | 'streaming' | 'error'

interface ProjectState {
  projects: ProjectInfo[]
  activeSessionId: string | null
  activeProjectPath: string | null
  sessionStatuses: Record<string, SessionStatus>
}

type ProjectAction =
  | { type: 'SET_PROJECTS'; projects: ProjectInfo[] }
  | { type: 'ADD_PROJECT'; project: ProjectInfo }
  | { type: 'REMOVE_PROJECT'; projectId: string }
  | { type: 'SET_SESSIONS'; projectId: string; sessions: ProjectInfo['sessions'] }
  | { type: 'ADD_SESSION_TO_PROJECT'; projectPath: string; session: SessionInfoDisplay }
  | { type: 'SET_ACTIVE_SESSION'; sessionId: string; projectPath: string }
  | { type: 'RECONNECT_SESSION'; sessionId: string; projectPath: string }
  | { type: 'UPDATE_SESSION_STATUS'; sessionId: string; status: SessionStatus }
  | { type: 'CLEAR_ACTIVE_SESSION' }

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

const INITIAL_STATE: ProjectState = {
  projects: [],
  activeSessionId: null,
  activeProjectPath: null,
  sessionStatuses: {},
}

function reducer(state: ProjectState, action: ProjectAction): ProjectState {
  logger.debug(`action: ${action.type}`)
  switch (action.type) {
    case 'SET_PROJECTS':
      return {
        ...state,
        projects: action.projects,
      }

    case 'ADD_PROJECT':
      return {
        ...state,
        projects: state.projects.some(p => p.id === action.project.id)
          ? state.projects
          : [...state.projects, action.project],
      }

    case 'REMOVE_PROJECT': {
      const removed = state.projects.find(p => p.id === action.projectId)
      const clearedActive =
        removed && state.activeProjectPath === removed.path
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.projectId),
        ...(clearedActive
          ? { activeSessionId: null, activeProjectPath: null }
          : {}),
      }
    }

    case 'SET_SESSIONS':
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === action.projectId
            ? { ...p, sessions: action.sessions }
            : p,
        ),
      }

    case 'ADD_SESSION_TO_PROJECT':
      return {
        ...state,
        projects: state.projects.map(p =>
          p.path === action.projectPath
            ? { ...p, sessions: [...p.sessions, action.session] }
            : p,
        ),
      }

    case 'SET_ACTIVE_SESSION':
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeProjectPath: action.projectPath,
      }

    case 'RECONNECT_SESSION':
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeProjectPath: action.projectPath,
      }

    case 'UPDATE_SESSION_STATUS':
      return {
        ...state,
        sessionStatuses: {
          ...state.sessionStatuses,
          [action.sessionId]: action.status,
        },
      }

    case 'CLEAR_ACTIVE_SESSION':
      return {
        ...state,
        activeSessionId: null,
        activeProjectPath: null,
      }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ProjectStoreAPI {
  state: ProjectState
  addProject: (path: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  setActiveSession: (sessionId: string, projectPath: string) => void
  reconnectSession: (sessionId: string, projectPath: string) => Promise<void>
  createSession: (projectPath: string) => Promise<void>
  refreshSessions: (projectId: string) => Promise<void>
}

const ProjectStoreContext = createContext<ProjectStoreAPI | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const initializedRef = useRef(false)

  // Load persisted workspace on first mount
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    ;(async () => {
      try {
        logger.info('initializing workspace')
        const projects = await window.nekocode.project.list()
        logger.info(`workspace: ${projects.length} project(s) loaded`)
        if (projects.length > 0) {
          dispatch({ type: 'SET_PROJECTS', projects })

          // Restore last active session by reconnecting the Pi session
          const { sessionId, projectPath } = await window.nekocode.workspace.getActive()
          if (sessionId && projectPath) {
            // Verify the session still exists in the restored projects
            const project = projects.find(p => p.path === projectPath)
            if (project && project.sessions.some(s => s.id === sessionId)) {
              try {
                await window.nekocode.session.reconnect(sessionId, projectPath)
                dispatch({ type: 'RECONNECT_SESSION', sessionId, projectPath })
              } catch (err) {
                logger.error('Failed to reconnect restored session', err)
              }
            }
          }
        }
      } catch (err) {
        logger.error('Failed to load workspace', err)
      }
    })()
  }, [])

  // Persist active session changes to workspace
  useEffect(() => {
    if (!initializedRef.current) return
    if (state.activeSessionId && state.activeProjectPath) {
      window.nekocode.workspace.setActive(state.activeSessionId, state.activeProjectPath)
        .catch(err => logger.error('Failed to persist active session', err))
    }
  }, [state.activeSessionId, state.activeProjectPath])

  // Global event listener — runs once for ALL sessions
  useEffect(() => {
    const unsub = window.nekocode.session.onEvent((payload) => {
      const { sessionId, event } = payload

      switch (event.type) {
        case 'text_delta': {
          // Set streaming immediately, then debounce resetting to idle
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'streaming' })

          const existing = debounceRef.current.get(sessionId)
          if (existing) clearTimeout(existing)

          const timer = setTimeout(() => {
            debounceRef.current.delete(sessionId)
            // Only reset if still streaming (no done/error arrived in the window)
            dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'idle' })
          }, 2000)

          debounceRef.current.set(sessionId, timer)
          break
        }

        case 'done': {
          const timer = debounceRef.current.get(sessionId)
          if (timer) {
            clearTimeout(timer)
            debounceRef.current.delete(sessionId)
          }
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'idle' })
          break
        }

        case 'error': {
          const timer = debounceRef.current.get(sessionId)
          if (timer) {
            clearTimeout(timer)
            debounceRef.current.delete(sessionId)
          }
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
          break
        }
      }
    })

    return () => {
      unsub()
      debounceRef.current.forEach(timer => clearTimeout(timer))
      debounceRef.current.clear()
    }
  }, [])

  const addProject = useCallback(async (path: string) => {
    try {
      const project = await window.nekocode.project.add(path)
      logger.info(`addProject OK: ${path}`)
      dispatch({ type: 'ADD_PROJECT', project })
    } catch (err) {
      logger.error('addProject failed:', err)
    }
  }, [])

  const removeProject = useCallback(async (projectId: string) => {
    try {
      await window.nekocode.project.remove(projectId)
      logger.info(`removeProject OK: ${projectId}`)
      dispatch({ type: 'REMOVE_PROJECT', projectId })
    } catch (err) {
      logger.error('removeProject failed:', err)
    }
  }, [])

  const setActiveSession = useCallback(
    (sessionId: string, projectPath: string) => {
      dispatch({ type: 'SET_ACTIVE_SESSION', sessionId, projectPath })
    },
    [],
  )

  const reconnectSession = useCallback(
    async (sessionId: string, projectPath: string) => {
      try {
        await window.nekocode.session.reconnect(sessionId, projectPath)
        logger.info(`reconnectSession OK: ${sessionId.slice(0, 8)}...`)
        dispatch({ type: 'RECONNECT_SESSION', sessionId, projectPath })
      } catch (err) {
          logger.error('reconnectSession failed:', err)
      }
    },
    [],
  )

  const createSession = useCallback(
    async (projectPath: string) => {
      try {
        const result = await window.nekocode.session.create(projectPath)
        logger.info(`createSession OK: ${result.sessionId.slice(0, 8)}... cwd=${projectPath}`)
        dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: result.sessionId, projectPath })
        dispatch({
          type: 'ADD_SESSION_TO_PROJECT',
          projectPath,
          session: {
            id: result.sessionId,
            firstMessage: 'New session',
            created: new Date().toISOString(),
            messageCount: 0,
          },
        })
      } catch (err) {
          logger.error('createSession failed:', err)
      }
    },
    [],
  )

  const refreshSessions = useCallback(async (projectId: string) => {
    try {
      const updated = await window.nekocode.project.sessions(projectId)
      logger.info(`refreshSessions OK: ${projectId} sessions=${updated.sessions.length}`)
      dispatch({ type: 'SET_SESSIONS', projectId, sessions: updated.sessions })
    } catch (err) {
      logger.error('refreshSessions failed:', err)
    }
  }, [])

  const api: ProjectStoreAPI = {
    state,
    addProject,
    removeProject,
    setActiveSession,
    reconnectSession,
    createSession,
    refreshSessions,
  }

  return (
    <ProjectStoreContext.Provider value={api}>
      {children}
    </ProjectStoreContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProjectStore(): ProjectStoreAPI {
  const ctx = useContext(ProjectStoreContext)
  if (!ctx) {
    throw new Error('useProjectStore must be used within a ProjectProvider')
  }
  return ctx
}
