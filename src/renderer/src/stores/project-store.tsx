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
  ExtensionLoadError,
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
      logger.debug(`SET_PROJECTS: ${action.projects.length} project(s)`)
      return {
        ...state,
        projects: action.projects,
      }

    case 'ADD_PROJECT':
      logger.debug(`ADD_PROJECT: id=${action.project.id} path=${action.project.path}`)
      return {
        ...state,
        projects: state.projects.some(p => p.id === action.project.id)
          ? state.projects
          : [...state.projects, action.project],
      }

    case 'REMOVE_PROJECT': {
      const removed = state.projects.find(p => p.id === action.projectId)
      logger.debug(`REMOVE_PROJECT: id=${action.projectId} found=${!!removed}`)
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
      logger.debug(`ADD_SESSION_TO_PROJECT: path=${action.projectPath} sessionId=${action.session.id}`)
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
      logger.debug('CLEAR_ACTIVE_SESSION')
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
  const initializedRef = useRef(false)

  const logExtensionLoadWarnings = useCallback((
    mode: 'create' | 'reconnect',
    sessionId: string,
    errors?: ExtensionLoadError[],
    extensionsDisabled?: boolean,
  ) => {
    if (!errors || errors.length === 0) return
    if (extensionsDisabled) {
      logger.warn(`[${mode}] sessionId=${sessionId.slice(0, 8)}... running in degraded mode (extensions disabled)`)
    }
    logger.warn(`[${mode}] sessionId=${sessionId.slice(0, 8)}... extension load errors=${errors.length}`)
    for (const error of errors) {
      logger.warn(`[${mode}] path=${error.path} message=${error.message}`)
      if (error.stack) {
        logger.debug(`[${mode}] stack for ${error.path}:\n${error.stack}`)
      }
    }
    if (!extensionsDisabled) {
      dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
    }
  }, [])

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
                const result = await window.nekocode.session.reconnect(sessionId, projectPath)
                logExtensionLoadWarnings('reconnect', sessionId, result.extensionErrors, result.extensionsDisabled)
                dispatch({ type: 'RECONNECT_SESSION', sessionId, projectPath })
              } catch (err) {
                logger.error('Failed to reconnect restored session', err)
                dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
              }
            }
          }
        }
      } catch (err) {
        logger.error('Failed to load workspace', err)
      }
    })()
  }, [logExtensionLoadWarnings])

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
        case 'agent_start':
          logger.debug(`[global] agent_start sessionId=${sessionId.slice(0, 8)}...`)
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'streaming' })
          break

        case 'done':
          logger.debug(`[global] done sessionId=${sessionId.slice(0, 8)}...`)
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'idle' })
          break

        case 'error':
          logger.debug(`[global] error sessionId=${sessionId.slice(0, 8)}... message=${event.message}`)
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
          break
      }
    })

    return () => {
      unsub()
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
        const result = await window.nekocode.session.reconnect(sessionId, projectPath)
        logExtensionLoadWarnings('reconnect', sessionId, result.extensionErrors, result.extensionsDisabled)
        logger.info(`reconnectSession OK: ${sessionId.slice(0, 8)}...`)
        dispatch({ type: 'RECONNECT_SESSION', sessionId, projectPath })
      } catch (err) {
          logger.error('reconnectSession failed:', err)
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
      }
    },
    [logExtensionLoadWarnings],
  )

  const createSession = useCallback(
    async (projectPath: string) => {
      try {
        const result = await window.nekocode.session.create(projectPath)
        logExtensionLoadWarnings('create', result.sessionId, result.extensionErrors, result.extensionsDisabled)
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
    [logExtensionLoadWarnings],
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
