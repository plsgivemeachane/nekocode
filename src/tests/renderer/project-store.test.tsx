import { describe, it, expect } from 'vitest'
import type { ProjectInfo, SessionInfoDisplay } from '@/shared/ipc-types'

type SessionStatus = 'idle' | 'streaming' | 'error'

/**
 * project-store reducer tests — pure function unit tests.
 *
 * The reducer is extracted here as an inline copy because it's not
 * exported from project-store.tsx. If it gets exported in the future,
 * replace this with a direct import.
 */

// ── Types (match source) ───────────────────────────────────────────

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

// ── Reducer (exact copy from source) ────────────────────────────────

const INITIAL_STATE: ProjectState = {
  projects: [],
  activeSessionId: null,
  activeProjectPath: null,
  sessionStatuses: {},
}

function reducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects }

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

// ── Helpers ─────────────────────────────────────────────────────────

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'Test Project',
    path: overrides.path ?? '/test/path',
    sessions: overrides.sessions ?? [],
  }
}

function makeSession(overrides: Partial<SessionInfoDisplay> = {}): SessionInfoDisplay {
  return {
    id: overrides.id ?? 'sess-1',
    firstMessage: overrides.firstMessage ?? 'Hello',
    created: overrides.created ?? '2025-01-01T00:00:00.000Z',
    messageCount: overrides.messageCount ?? 5,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('project-store reducer', () => {
  describe('initial state', () => {
    it('has empty projects, null active session', () => {
      expect(INITIAL_STATE.projects).toEqual([])
      expect(INITIAL_STATE.activeSessionId).toBeNull()
      expect(INITIAL_STATE.activeProjectPath).toBeNull()
      expect(INITIAL_STATE.sessionStatuses).toEqual({})
    })
  })

  describe('SET_PROJECTS', () => {
    it('replaces all projects', () => {
      const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })]
      const state = reducer(INITIAL_STATE, { type: 'SET_PROJECTS', projects })
      expect(state.projects).toHaveLength(2)
      expect(state.projects.map(p => p.id)).toEqual(['p1', 'p2'])
    })

    it('clears existing projects', () => {
      const withProjects = reducer(INITIAL_STATE, {
        type: 'SET_PROJECTS',
        projects: [makeProject()],
      })
      const cleared = reducer(withProjects, { type: 'SET_PROJECTS', projects: [] })
      expect(cleared.projects).toEqual([])
    })
  })

  describe('ADD_PROJECT', () => {
    it('adds a project to empty state', () => {
      const project = makeProject({ id: 'p1' })
      const state = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      expect(state.projects).toHaveLength(1)
      expect(state.projects[0].id).toBe('p1')
    })

    it('appends to existing projects', () => {
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project: makeProject({ id: 'p1' }) })
      const s2 = reducer(s1, { type: 'ADD_PROJECT', project: makeProject({ id: 'p2' }) })
      expect(s2.projects).toHaveLength(2)
    })

    it('deduplicates by id', () => {
      const project = makeProject({ id: 'p1', name: 'Original' })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      const s2 = reducer(s1, { type: 'ADD_PROJECT', project: { ...project, name: 'Updated' } })
      expect(s2.projects).toHaveLength(1)
      expect(s2.projects[0].name).toBe('Original')
    })
  })

  describe('REMOVE_PROJECT', () => {
    it('removes project by id', () => {
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project: makeProject({ id: 'p1' }) })
      const s2 = reducer(s1, { type: 'ADD_PROJECT', project: makeProject({ id: 'p2' }) })
      const s3 = reducer(s2, { type: 'REMOVE_PROJECT', projectId: 'p1' })
      expect(s3.projects).toHaveLength(1)
      expect(s3.projects[0].id).toBe('p2')
    })

    it('returns unchanged state for non-existent id', () => {
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project: makeProject({ id: 'p1' }) })
      const s2 = reducer(s1, { type: 'REMOVE_PROJECT', projectId: 'nonexistent' })
      expect(s2.projects).toHaveLength(1)
    })

    it('clears active session when removed project matches active path', () => {
      const project = makeProject({ id: 'p1', path: '/my/project' })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      const s2 = reducer(s1, { type: 'SET_ACTIVE_SESSION', sessionId: 's1', projectPath: '/my/project' })
      expect(s2.activeSessionId).toBe('s1')

      const s3 = reducer(s2, { type: 'REMOVE_PROJECT', projectId: 'p1' })
      expect(s3.activeSessionId).toBeNull()
      expect(s3.activeProjectPath).toBeNull()
    })

    it('does not clear active session when removed project has different path', () => {
      const p1 = makeProject({ id: 'p1', path: '/project/a' })
      const p2 = makeProject({ id: 'p2', path: '/project/b' })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project: p1 })
      const s2 = reducer(s1, { type: 'ADD_PROJECT', project: p2 })
      const s3 = reducer(s2, { type: 'SET_ACTIVE_SESSION', sessionId: 's1', projectPath: '/project/a' })

      const s4 = reducer(s3, { type: 'REMOVE_PROJECT', projectId: 'p2' })
      expect(s4.activeSessionId).toBe('s1')
      expect(s4.activeProjectPath).toBe('/project/a')
    })
  })

  describe('SET_SESSIONS', () => {
    it('updates sessions for matching project', () => {
      const project = makeProject({ id: 'p1', sessions: [] })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      const newSessions = [makeSession({ id: 's1' }), makeSession({ id: 's2' })]
      const s2 = reducer(s1, { type: 'SET_SESSIONS', projectId: 'p1', sessions: newSessions })
      expect(s2.projects[0].sessions).toHaveLength(2)
    })

    it('does not affect other projects', () => {
      const p1 = makeProject({ id: 'p1', sessions: [makeSession({ id: 'old' })] })
      const p2 = makeProject({ id: 'p2', sessions: [makeSession({ id: 'keep' })] })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project: p1 })
      const s2 = reducer(s1, { type: 'ADD_PROJECT', project: p2 })
      const s3 = reducer(s2, { type: 'SET_SESSIONS', projectId: 'p1', sessions: [] })

      expect(s3.projects[0].sessions).toHaveLength(0)
      expect(s3.projects[1].sessions).toHaveLength(1)
      expect(s3.projects[1].sessions[0].id).toBe('keep')
    })
  })

  describe('ADD_SESSION_TO_PROJECT', () => {
    it('appends session to matching project by path', () => {
      const project = makeProject({ id: 'p1', path: '/my/project', sessions: [makeSession({ id: 's1' })] })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      const newSession = makeSession({ id: 's2', firstMessage: 'New' })
      const s2 = reducer(s1, { type: 'ADD_SESSION_TO_PROJECT', projectPath: '/my/project', session: newSession })

      expect(s2.projects[0].sessions).toHaveLength(2)
      expect(s2.projects[0].sessions[1].id).toBe('s2')
    })

    it('does not affect other projects', () => {
      const p1 = makeProject({ id: 'p1', path: '/a' })
      const p2 = makeProject({ id: 'p2', path: '/b' })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project: p1 })
      const s2 = reducer(s1, { type: 'ADD_PROJECT', project: p2 })
      const s3 = reducer(s2, { type: 'ADD_SESSION_TO_PROJECT', projectPath: '/a', session: makeSession() })

      expect(s3.projects[0].sessions).toHaveLength(1)
      expect(s3.projects[1].sessions).toHaveLength(0)
    })
  })

  describe('SET_ACTIVE_SESSION / RECONNECT_SESSION', () => {
    it('sets active session and project path', () => {
      const state = reducer(INITIAL_STATE, {
        type: 'SET_ACTIVE_SESSION',
        sessionId: 's1',
        projectPath: '/my/project',
      })
      expect(state.activeSessionId).toBe('s1')
      expect(state.activeProjectPath).toBe('/my/project')
    })

    it('RECONNECT_SESSION behaves the same as SET_ACTIVE_SESSION', () => {
      const s1 = reducer(INITIAL_STATE, {
        type: 'SET_ACTIVE_SESSION', sessionId: 's1', projectPath: '/p',
      })
      const s2 = reducer(INITIAL_STATE, {
        type: 'RECONNECT_SESSION', sessionId: 's1', projectPath: '/p',
      })
      expect(s1).toEqual(s2)
    })
  })

  describe('CLEAR_ACTIVE_SESSION', () => {
    it('clears active session and project path', () => {
      const s1 = reducer(INITIAL_STATE, {
        type: 'SET_ACTIVE_SESSION', sessionId: 's1', projectPath: '/p',
      })
      const s2 = reducer(s1, { type: 'CLEAR_ACTIVE_SESSION' })
      expect(s2.activeSessionId).toBeNull()
      expect(s2.activeProjectPath).toBeNull()
    })

    it('is safe to call when already null', () => {
      const state = reducer(INITIAL_STATE, { type: 'CLEAR_ACTIVE_SESSION' })
      expect(state.activeSessionId).toBeNull()
      expect(state.activeProjectPath).toBeNull()
    })
  })

  describe('UPDATE_SESSION_STATUS', () => {
    it('sets status for a session', () => {
      const state = reducer(INITIAL_STATE, {
        type: 'UPDATE_SESSION_STATUS', sessionId: 's1', status: 'streaming',
      })
      expect(state.sessionStatuses['s1']).toBe('streaming')
    })

    it('updates status for existing session', () => {
      const s1 = reducer(INITIAL_STATE, {
        type: 'UPDATE_SESSION_STATUS', sessionId: 's1', status: 'streaming',
      })
      const s2 = reducer(s1, {
        type: 'UPDATE_SESSION_STATUS', sessionId: 's1', status: 'idle',
      })
      expect(s2.sessionStatuses['s1']).toBe('idle')
    })

    it('does not affect other session statuses', () => {
      const s1 = reducer(INITIAL_STATE, {
        type: 'UPDATE_SESSION_STATUS', sessionId: 's1', status: 'streaming',
      })
      const s2 = reducer(s1, {
        type: 'UPDATE_SESSION_STATUS', sessionId: 's2', status: 'error',
      })
      expect(s2.sessionStatuses['s1']).toBe('streaming')
      expect(s2.sessionStatuses['s2']).toBe('error')
    })

    it('preserves other state fields', () => {
      const project = makeProject()
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      const s2 = reducer(s1, {
        type: 'SET_ACTIVE_SESSION', sessionId: 's1', projectPath: '/p',
      })
      const s3 = reducer(s2, {
        type: 'UPDATE_SESSION_STATUS', sessionId: 's1', status: 'streaming',
      })
      expect(s3.projects).toHaveLength(1)
      expect(s3.activeSessionId).toBe('s1')
      expect(s3.activeProjectPath).toBe('/p')
      expect(s3.sessionStatuses['s1']).toBe('streaming')
    })
  })

  describe('unknown action type', () => {
    it('returns unchanged state', () => {
      const state = reducer(INITIAL_STATE, { type: 'UNKNOWN_ACTION' } as never)
      expect(state).toBe(INITIAL_STATE)
    })
  })

  describe('immutability', () => {
    it('does not mutate the input state', () => {
      const original = { ...INITIAL_STATE }
      reducer(INITIAL_STATE, { type: 'SET_PROJECTS', projects: [makeProject()] })
      expect(INITIAL_STATE).toEqual(original)
    })

    it('does not mutate existing project objects', () => {
      const project = makeProject({ sessions: [] })
      const s1 = reducer(INITIAL_STATE, { type: 'ADD_PROJECT', project })
      const s2 = reducer(s1, { type: 'SET_SESSIONS', projectId: 'proj-1', sessions: [makeSession()] })
      expect(s2.projects[0].sessions).toHaveLength(1)
      expect(project.sessions).toHaveLength(0) // original unchanged
    })
  })
})
