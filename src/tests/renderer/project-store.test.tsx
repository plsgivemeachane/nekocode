import { describe, it, expect } from "vitest"
import type { ProjectInfo, SessionInfoDisplay, ChatMessageIPC } from "@/shared/ipc-types"

// ── Types (match source exactly) ───────────────────────────────────

type SessionStatus = "idle" | "streaming" | "error"

interface ProjectState {
  projects: ProjectInfo[]
  activeSessionId: string | null
  activeProjectPath: string | null
  sessionStatuses: Record<string, SessionStatus>
  preloadedHistory: Record<string, ChatMessageIPC[]>
  agentReady: boolean
}

type ProjectAction =
  | { type: "SET_PROJECTS"; projects: ProjectInfo[] }
  | { type: "ADD_PROJECT"; project: ProjectInfo }
  | { type: "REMOVE_PROJECT"; projectId: string }
  | { type: "SET_SESSIONS"; projectId: string; sessions: ProjectInfo["sessions"] }
  | { type: "ADD_SESSION_TO_PROJECT"; projectPath: string; session: SessionInfoDisplay }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string; projectPath: string }
  | { type: "RECONNECT_SESSION"; sessionId: string; projectPath: string }
  | { type: "UPDATE_SESSION_STATUS"; sessionId: string; status: SessionStatus }
  | { type: "CLEAR_ACTIVE_SESSION" }
  | { type: "UPDATE_SESSION_FIRST_MESSAGE"; sessionId: string; firstMessage: string }
  | { type: "SET_SESSION_MESSAGE_COUNT"; sessionId: string; messageCount: number }
  | { type: "PRELOAD_HISTORY"; sessionId: string; messages: ChatMessageIPC[] }
  | { type: "SET_AGENT_CONNECTING" }
  | { type: "SET_AGENT_READY"; sessionId: string }

// ── Reducer (exact copy from source for pure unit testing) ─────────

const INITIAL_STATE: ProjectState = {
  projects: [],
  activeSessionId: null,
  activeProjectPath: null,
  sessionStatuses: {},
  preloadedHistory: {},
  agentReady: true,
}

function updateSessionInProject(
  projects: ProjectInfo[],
  sessionId: string,
  updater: (session: SessionInfoDisplay) => SessionInfoDisplay,
): ProjectInfo[] {
  for (const p of projects) {
    for (let i = 0; i < p.sessions.length; i++) {
      if (p.sessions[i].id === sessionId) {
        const updated = updater(p.sessions[i])
        if (updated !== p.sessions[i]) {
          return projects.map((proj) =>
            proj.path === p.path
              ? {
                  ...proj,
                  sessions: proj.sessions.map((s) =>
                    s.id === sessionId ? updated : s,
                  ),
                }
              : proj,
          )
        }
        return projects
      }
    }
  }
  return projects
}

function reducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case "SET_PROJECTS":
      return { ...state, projects: action.projects }

    case "ADD_PROJECT":
      return {
        ...state,
        projects: state.projects.some((p) => p.id === action.project.id)
          ? state.projects
          : [...state.projects, action.project],
      }

    case "REMOVE_PROJECT": {
      const removed = state.projects.find((p) => p.id === action.projectId)
      const clearedActive = removed && state.activeProjectPath === removed.path
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.projectId),
        ...(clearedActive ? { activeSessionId: null, activeProjectPath: null } : {}),
      }
    }

    case "SET_SESSIONS":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, sessions: action.sessions } : p,
        ),
      }

    case "ADD_SESSION_TO_PROJECT":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.path === action.projectPath
            ? { ...p, sessions: [action.session, ...p.sessions] }
            : p,
        ),
      }

    case "SET_ACTIVE_SESSION":
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeProjectPath: action.projectPath,
      }

    case "RECONNECT_SESSION":
      if (state.activeSessionId !== action.sessionId) {
        return state
      }
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeProjectPath: action.projectPath,
      }

    case "UPDATE_SESSION_STATUS":
      return {
        ...state,
        sessionStatuses: { ...state.sessionStatuses, [action.sessionId]: action.status },
      }

    case "CLEAR_ACTIVE_SESSION":
      return { ...state, activeSessionId: null, activeProjectPath: null }

    case "UPDATE_SESSION_FIRST_MESSAGE":
      return {
        ...state,
        projects: updateSessionInProject(state.projects, action.sessionId, (s) => ({
          ...s,
          firstMessage: action.firstMessage,
          messageCount: Math.max(s.messageCount, 1),
        })),
      }

    case "SET_SESSION_MESSAGE_COUNT":
      return {
        ...state,
        projects: updateSessionInProject(state.projects, action.sessionId, (s) => ({
          ...s,
          messageCount: Math.max(s.messageCount, action.messageCount),
        })),
      }

    case "PRELOAD_HISTORY":
      return {
        ...state,
        preloadedHistory: { ...state.preloadedHistory, [action.sessionId]: action.messages },
      }

    case "SET_AGENT_CONNECTING":
      return { ...state, agentReady: false }

    case "SET_AGENT_READY":
      if (state.activeSessionId !== action.sessionId) {
        return state
      }
      return { ...state, agentReady: true }

    default:
      return state
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: overrides.id ?? "proj-1",
    name: overrides.name ?? "Test Project",
    path: overrides.path ?? "/test/path",
    sessions: overrides.sessions ?? [],
  }
}

function makeSession(overrides: Partial<SessionInfoDisplay> = {}): SessionInfoDisplay {
  return {
    id: overrides.id ?? "sess-1",
    firstMessage: overrides.firstMessage ?? "Hello",
    created: overrides.created ?? "2025-01-01T00:00:00.000Z",
    messageCount: overrides.messageCount ?? 5,
  }
}

function stateWithActive(sessionId: string, projectPath: string): ProjectState {
  return reducer(INITIAL_STATE, {
    type: "SET_ACTIVE_SESSION",
    sessionId,
    projectPath,
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe("project-store reducer", () => {
  describe("initial state", () => {
    it("has empty projects, null active session", () => {
      expect(INITIAL_STATE.projects).toEqual([])
      expect(INITIAL_STATE.activeSessionId).toBeNull()
      expect(INITIAL_STATE.activeProjectPath).toBeNull()
      expect(INITIAL_STATE.sessionStatuses).toEqual({})
      expect(INITIAL_STATE.preloadedHistory).toEqual({})
      expect(INITIAL_STATE.agentReady).toBe(true)
    })
  })

  describe("SET_PROJECTS", () => {
    it("replaces all projects", () => {
      const projects = [makeProject({ id: "p1" }), makeProject({ id: "p2" })]
      const state = reducer(INITIAL_STATE, { type: "SET_PROJECTS", projects })
      expect(state.projects).toHaveLength(2)
      expect(state.projects.map((p) => p.id)).toEqual(["p1", "p2"])
    })

    it("clears existing projects", () => {
      const withProjects = reducer(INITIAL_STATE, { type: "SET_PROJECTS", projects: [makeProject()] })
      const cleared = reducer(withProjects, { type: "SET_PROJECTS", projects: [] })
      expect(cleared.projects).toEqual([])
    })
  })

  describe("ADD_PROJECT", () => {
    it("adds a project to empty state", () => {
      const project = makeProject({ id: "p1" })
      const state = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      expect(state.projects).toHaveLength(1)
      expect(state.projects[0].id).toBe("p1")
    })

    it("appends to existing projects", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject({ id: "p1" }) })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: makeProject({ id: "p2" }) })
      expect(s2.projects).toHaveLength(2)
    })

    it("deduplicates by id", () => {
      const project = makeProject({ id: "p1", name: "Original" })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: { ...project, name: "Updated" } })
      expect(s2.projects).toHaveLength(1)
      expect(s2.projects[0].name).toBe("Original")
    })
  })

  describe("REMOVE_PROJECT", () => {
    it("removes project by id", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject({ id: "p1" }) })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: makeProject({ id: "p2" }) })
      const s3 = reducer(s2, { type: "REMOVE_PROJECT", projectId: "p1" })
      expect(s3.projects).toHaveLength(1)
      expect(s3.projects[0].id).toBe("p2")
    })

    it("returns unchanged for non-existent id", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject({ id: "p1" }) })
      const s2 = reducer(s1, { type: "REMOVE_PROJECT", projectId: "nonexistent" })
      expect(s2.projects).toHaveLength(1)
    })

    it("clears active session when removed project matches active path", () => {
      const project = makeProject({ id: "p1", path: "/my/project" })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "SET_ACTIVE_SESSION", sessionId: "s1", projectPath: "/my/project" })
      const s3 = reducer(s2, { type: "REMOVE_PROJECT", projectId: "p1" })
      expect(s3.activeSessionId).toBeNull()
      expect(s3.activeProjectPath).toBeNull()
    })

    it("does not clear active session when removed project has different path", () => {
      const p1 = makeProject({ id: "p1", path: "/project/a" })
      const p2 = makeProject({ id: "p2", path: "/project/b" })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: p1 })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: p2 })
      const s3 = reducer(s2, { type: "SET_ACTIVE_SESSION", sessionId: "s1", projectPath: "/project/a" })
      const s4 = reducer(s3, { type: "REMOVE_PROJECT", projectId: "p2" })
      expect(s4.activeSessionId).toBe("s1")
      expect(s4.activeProjectPath).toBe("/project/a")
    })
  })

  describe("SET_SESSIONS", () => {
    it("updates sessions for matching project", () => {
      const project = makeProject({ id: "p1", sessions: [] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const newSessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" })]
      const s2 = reducer(s1, { type: "SET_SESSIONS", projectId: "p1", sessions: newSessions })
      expect(s2.projects[0].sessions).toHaveLength(2)
    })

    it("does not affect other projects", () => {
      const p1 = makeProject({ id: "p1", sessions: [makeSession({ id: "old" })] })
      const p2 = makeProject({ id: "p2", sessions: [makeSession({ id: "keep" })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: p1 })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: p2 })
      const s3 = reducer(s2, { type: "SET_SESSIONS", projectId: "p1", sessions: [] })
      expect(s3.projects[0].sessions).toHaveLength(0)
      expect(s3.projects[1].sessions).toHaveLength(1)
      expect(s3.projects[1].sessions[0].id).toBe("keep")
    })
  })

  describe("ADD_SESSION_TO_PROJECT", () => {
    it("prepends session to matching project by path", () => {
      const project = makeProject({ id: "p1", path: "/my/project", sessions: [makeSession({ id: "s1" })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const newSession = makeSession({ id: "s2", firstMessage: "New" })
      const s2 = reducer(s1, { type: "ADD_SESSION_TO_PROJECT", projectPath: "/my/project", session: newSession })
      expect(s2.projects[0].sessions).toHaveLength(2)
      expect(s2.projects[0].sessions[0].id).toBe("s2")
    })

    it("does not affect other projects", () => {
      const p1 = makeProject({ id: "p1", path: "/a" })
      const p2 = makeProject({ id: "p2", path: "/b" })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: p1 })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: p2 })
      const s3 = reducer(s2, { type: "ADD_SESSION_TO_PROJECT", projectPath: "/a", session: makeSession() })
      expect(s3.projects[0].sessions).toHaveLength(1)
      expect(s3.projects[1].sessions).toHaveLength(0)
    })
  })

  describe("SET_ACTIVE_SESSION", () => {
    it("sets active session and project path", () => {
      const state = reducer(INITIAL_STATE, {
        type: "SET_ACTIVE_SESSION", sessionId: "s1", projectPath: "/my/project",
      })
      expect(state.activeSessionId).toBe("s1")
      expect(state.activeProjectPath).toBe("/my/project")
    })
  })

  describe("RECONNECT_SESSION", () => {
    it("updates active session when matching", () => {
      const s1 = stateWithActive("s1", "/p")
      const s2 = reducer(s1, { type: "RECONNECT_SESSION", sessionId: "s1", projectPath: "/p" })
      expect(s2.activeSessionId).toBe("s1")
      expect(s2.activeProjectPath).toBe("/p")
    })

    it("ignores stale reconnect when activeSessionId differs", () => {
      const s1 = stateWithActive("s1", "/p")
      const s2 = reducer(s1, { type: "RECONNECT_SESSION", sessionId: "s2", projectPath: "/other" })
      expect(s2).toBe(s1)
    })

    it("ignores stale reconnect when activeSessionId is null", () => {
      const s1 = reducer(INITIAL_STATE, { type: "RECONNECT_SESSION", sessionId: "s1", projectPath: "/p" })
      expect(s1).toBe(INITIAL_STATE)
    })
  })

  describe("UPDATE_SESSION_STATUS", () => {
    it("sets status for a session", () => {
      const state = reducer(INITIAL_STATE, {
        type: "UPDATE_SESSION_STATUS", sessionId: "s1", status: "streaming",
      })
      expect(state.sessionStatuses["s1"]).toBe("streaming")
    })

    it("updates status for existing session", () => {
      const s1 = reducer(INITIAL_STATE, { type: "UPDATE_SESSION_STATUS", sessionId: "s1", status: "streaming" })
      const s2 = reducer(s1, { type: "UPDATE_SESSION_STATUS", sessionId: "s1", status: "idle" })
      expect(s2.sessionStatuses["s1"]).toBe("idle")
    })

    it("does not affect other session statuses", () => {
      const s1 = reducer(INITIAL_STATE, { type: "UPDATE_SESSION_STATUS", sessionId: "s1", status: "streaming" })
      const s2 = reducer(s1, { type: "UPDATE_SESSION_STATUS", sessionId: "s2", status: "error" })
      expect(s2.sessionStatuses["s1"]).toBe("streaming")
      expect(s2.sessionStatuses["s2"]).toBe("error")
    })

    it("preserves other state fields", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject() })
      const s2 = reducer(s1, { type: "SET_ACTIVE_SESSION", sessionId: "s1", projectPath: "/p" })
      const s3 = reducer(s2, { type: "UPDATE_SESSION_STATUS", sessionId: "s1", status: "streaming" })
      expect(s3.projects).toHaveLength(1)
      expect(s3.activeSessionId).toBe("s1")
      expect(s3.sessionStatuses["s1"]).toBe("streaming")
    })
  })

  describe("CLEAR_ACTIVE_SESSION", () => {
    it("clears active session and project path", () => {
      const s1 = stateWithActive("s1", "/p")
      const s2 = reducer(s1, { type: "CLEAR_ACTIVE_SESSION" })
      expect(s2.activeSessionId).toBeNull()
      expect(s2.activeProjectPath).toBeNull()
    })

    it("is safe when already null", () => {
      const state = reducer(INITIAL_STATE, { type: "CLEAR_ACTIVE_SESSION" })
      expect(state.activeSessionId).toBeNull()
      expect(state.activeProjectPath).toBeNull()
    })
  })

  describe("UPDATE_SESSION_FIRST_MESSAGE", () => {
    it("updates firstMessage for matching session", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1", firstMessage: "Old" })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "UPDATE_SESSION_FIRST_MESSAGE", sessionId: "s1", firstMessage: "New first" })
      expect(s2.projects[0].sessions[0].firstMessage).toBe("New first")
    })

    it("sets messageCount to at least 1", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1", messageCount: 0 })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "UPDATE_SESSION_FIRST_MESSAGE", sessionId: "s1", firstMessage: "Hi" })
      expect(s2.projects[0].sessions[0].messageCount).toBe(1)
    })

    it("does not reduce messageCount below current value", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1", messageCount: 10 })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "UPDATE_SESSION_FIRST_MESSAGE", sessionId: "s1", firstMessage: "Hi" })
      expect(s2.projects[0].sessions[0].messageCount).toBe(10)
    })

    it("returns unchanged for non-existent session", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1" })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "UPDATE_SESSION_FIRST_MESSAGE", sessionId: "missing", firstMessage: "Hi" })
      expect(s2).toEqual(s1)
    })

    it("does not mutate the original session", () => {
      const session = makeSession({ id: "s1", firstMessage: "Original", messageCount: 0 })
      const project = makeProject({ sessions: [session] })
      reducer(reducer(INITIAL_STATE, { type: "ADD_PROJECT", project }), {
        type: "UPDATE_SESSION_FIRST_MESSAGE", sessionId: "s1", firstMessage: "Changed",
      })
      expect(session.firstMessage).toBe("Original")
      expect(session.messageCount).toBe(0)
    })
  })

  describe("SET_SESSION_MESSAGE_COUNT", () => {
    it("updates messageCount for matching session", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1", messageCount: 0 })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "SET_SESSION_MESSAGE_COUNT", sessionId: "s1", messageCount: 7 })
      expect(s2.projects[0].sessions[0].messageCount).toBe(7)
    })

    it("takes the max of current and new count", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1", messageCount: 10 })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "SET_SESSION_MESSAGE_COUNT", sessionId: "s1", messageCount: 3 })
      expect(s2.projects[0].sessions[0].messageCount).toBe(10)
    })

    it("returns unchanged for non-existent session", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1" })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "SET_SESSION_MESSAGE_COUNT", sessionId: "missing", messageCount: 5 })
      expect(s2).toEqual(s1)
    })

    it("finds session across multiple projects", () => {
      const p1 = makeProject({ id: "p1", sessions: [makeSession({ id: "s1", messageCount: 2 })] })
      const p2 = makeProject({ id: "p2", sessions: [makeSession({ id: "s2", messageCount: 1 })] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: p1 })
      const s2 = reducer(s1, { type: "ADD_PROJECT", project: p2 })
      const s3 = reducer(s2, { type: "SET_SESSION_MESSAGE_COUNT", sessionId: "s2", messageCount: 8 })
      expect(s3.projects[0].sessions[0].messageCount).toBe(2)
      expect(s3.projects[1].sessions[0].messageCount).toBe(8)
    })
  })

  describe("PRELOAD_HISTORY", () => {
    it("stores messages keyed by sessionId", () => {
      const msgs = [{ role: "user", content: "hi" } as ChatMessageIPC]
      const state = reducer(INITIAL_STATE, { type: "PRELOAD_HISTORY", sessionId: "s1", messages: msgs })
      expect(state.preloadedHistory["s1"]).toEqual(msgs)
    })

    it("overwrites previous preload for same session", () => {
      const msgs1 = [{ role: "user", content: "a" } as ChatMessageIPC]
      const msgs2 = [{ role: "user", content: "b" } as ChatMessageIPC]
      const s1 = reducer(INITIAL_STATE, { type: "PRELOAD_HISTORY", sessionId: "s1", messages: msgs1 })
      const s2 = reducer(s1, { type: "PRELOAD_HISTORY", sessionId: "s1", messages: msgs2 })
      expect(s2.preloadedHistory["s1"]).toEqual(msgs2)
    })

    it("does not affect other session preloads", () => {
      const msgs1 = [{ role: "user", content: "a" } as ChatMessageIPC]
      const msgs2 = [{ role: "user", content: "b" } as ChatMessageIPC]
      const s1 = reducer(INITIAL_STATE, { type: "PRELOAD_HISTORY", sessionId: "s1", messages: msgs1 })
      const s2 = reducer(s1, { type: "PRELOAD_HISTORY", sessionId: "s2", messages: msgs2 })
      expect(s2.preloadedHistory["s1"]).toEqual(msgs1)
      expect(s2.preloadedHistory["s2"]).toEqual(msgs2)
    })

    it("preserves other state fields", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject() })
      const s2 = reducer(s1, { type: "PRELOAD_HISTORY", sessionId: "s1", messages: [] })
      expect(s2.projects).toHaveLength(1)
    })
  })

  describe("SET_AGENT_CONNECTING", () => {
    it("sets agentReady to false", () => {
      const state = reducer(INITIAL_STATE, { type: "SET_AGENT_CONNECTING" })
      expect(state.agentReady).toBe(false)
    })

    it("overrides previous ready state", () => {
      const s1 = reducer(INITIAL_STATE, { type: "SET_AGENT_CONNECTING" })
      expect(s1.agentReady).toBe(false)
      const s2 = reducer(s1, { type: "SET_AGENT_CONNECTING" })
      expect(s2.agentReady).toBe(false)
    })

    it("preserves other state fields", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject() })
      const s2 = reducer(s1, { type: "SET_AGENT_CONNECTING" })
      expect(s2.projects).toHaveLength(1)
      expect(s2.activeSessionId).toBeNull()
    })
  })

  describe("SET_AGENT_READY", () => {
    it("sets agentReady to true when sessionId matches", () => {
      const s2 = stateWithActive("s1", "/p")
      const s3 = reducer(s2, { type: "SET_AGENT_READY", sessionId: "s1" })
      expect(s3.agentReady).toBe(true)
    })

    it("ignores stale SET_AGENT_READY when sessionId differs", () => {
      const s1 = reducer(stateWithActive("s1", "/p"), { type: "SET_AGENT_CONNECTING" })
      const s2 = reducer(s1, { type: "SET_AGENT_READY", sessionId: "s2" })
      expect(s2.agentReady).toBe(false)
    })

    it("ignores stale SET_AGENT_READY when activeSessionId is null", () => {
      const s1 = reducer(INITIAL_STATE, { type: "SET_AGENT_CONNECTING" })
      const s2 = reducer(s1, { type: "SET_AGENT_READY", sessionId: "s1" })
      expect(s2.agentReady).toBe(false)
    })

    it("preserves other state fields", () => {
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project: makeProject() })
      const s2 = reducer(s1, { type: "SET_ACTIVE_SESSION", sessionId: "s1", projectPath: "/p" })
      const s3 = reducer(s2, { type: "SET_AGENT_CONNECTING" })
      const s4 = reducer(s3, { type: "SET_AGENT_READY", sessionId: "s1" })
      expect(s4.projects).toHaveLength(1)
      expect(s4.activeSessionId).toBe("s1")
      expect(s4.agentReady).toBe(true)
    })
  })

  describe("unknown action type", () => {
    it("returns unchanged state", () => {
      const state = reducer(INITIAL_STATE, { type: "UNKNOWN_ACTION" } as never)
      expect(state).toBe(INITIAL_STATE)
    })
  })

  describe("immutability", () => {
    it("does not mutate the input state", () => {
      const original = { ...INITIAL_STATE }
      reducer(INITIAL_STATE, { type: "SET_PROJECTS", projects: [makeProject()] })
      expect(INITIAL_STATE).toEqual(original)
    })

    it("does not mutate existing project objects", () => {
      const project = makeProject({ sessions: [] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      const s2 = reducer(s1, { type: "SET_SESSIONS", projectId: "proj-1", sessions: [makeSession()] })
      expect(s2.projects[0].sessions).toHaveLength(1)
      expect(project.sessions).toHaveLength(0)
    })

    it("does not mutate session objects when using updateSessionInProject", () => {
      const session = makeSession({ id: "s1", messageCount: 0 })
      const project = makeProject({ sessions: [session] })
      const s1 = reducer(INITIAL_STATE, { type: "ADD_PROJECT", project })
      reducer(s1, { type: "SET_SESSION_MESSAGE_COUNT", sessionId: "s1", messageCount: 5 })
      expect(session.messageCount).toBe(0)
    })
  })
})
