import {
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
  SessionStreamEvent,
} from '../../../shared/ipc-types'

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
  | { type: 'ADD_PROJECT'; project: ProjectInfo }
  | { type: 'REMOVE_PROJECT'; projectId: string }
  | { type: 'SET_SESSIONS'; projectId: string; sessions: ProjectInfo['sessions'] }
  | { type: 'SET_ACTIVE_SESSION'; sessionId: string; projectPath: string }
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
  switch (action.type) {
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

    case 'SET_ACTIVE_SESSION':
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
      dispatch({ type: 'ADD_PROJECT', project })
    } catch (err) {
      console.error('[project-store] addProject failed:', err)
    }
  }, [])

  const removeProject = useCallback(async (projectId: string) => {
    try {
      await window.nekocode.project.remove(projectId)
      dispatch({ type: 'REMOVE_PROJECT', projectId })
    } catch (err) {
      console.error('[project-store] removeProject failed:', err)
    }
  }, [])

  const setActiveSession = useCallback(
    (sessionId: string, projectPath: string) => {
      dispatch({ type: 'SET_ACTIVE_SESSION', sessionId, projectPath })
    },
    [],
  )

  const createSession = useCallback(
    async (projectPath: string) => {
      try {
        const result = await window.nekocode.session.create(projectPath)
        dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: result.sessionId, projectPath })
      } catch (err) {
        console.error('[project-store] createSession failed:', err)
      }
    },
    [],
  )

  const refreshSessions = useCallback(async (projectId: string) => {
    try {
      const updated = await window.nekocode.project.sessions(projectId)
      dispatch({ type: 'SET_SESSIONS', projectId, sessions: updated.sessions })
    } catch (err) {
      console.error('[project-store] refreshSessions failed:', err)
    }
  }, [])

  const api: ProjectStoreAPI = {
    state,
    addProject,
    removeProject,
    setActiveSession,
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
