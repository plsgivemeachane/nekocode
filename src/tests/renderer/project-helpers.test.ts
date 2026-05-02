import { describe, it, expect } from "vitest"
import type { ProjectInfo, SessionInfoDisplay } from "@/shared/ipc-types"
import { updateSessionInProject, isPendingSession } from "@/renderer/src/utils/project-helpers"

// ── Helpers ─────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfoDisplay> = {}): SessionInfoDisplay {
  return {
    id: overrides.id ?? "sess-1",
    firstMessage: overrides.firstMessage ?? "Hello",
    created: overrides.created ?? "2025-01-01T00:00:00.000Z",
    messageCount: overrides.messageCount ?? 5,
  }
}

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: overrides.id ?? "proj-1",
    name: overrides.name ?? "Test Project",
    path: overrides.path ?? "/test/path",
    sessions: overrides.sessions ?? [],
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("updateSessionInProject", () => {
  describe("when session is found", () => {
    it("applies the updater to the matching session", () => {
      const projects = [
        makeProject({
          id: "p1",
          sessions: [makeSession({ id: "s1", firstMessage: "Old" })],
        }),
      ]
      const result = updateSessionInProject(projects, "s1", (s) => ({
        ...s,
        firstMessage: "New",
      }))
      expect(result[0].sessions[0].firstMessage).toBe("New")
    })

    it("does not mutate the original projects array", () => {
      const original = makeProject({
        sessions: [makeSession({ id: "s1" })],
      })
      const projects = [original]
      updateSessionInProject(projects, "s1", (s) => ({ ...s, firstMessage: "Changed" }))
      expect(original.sessions[0].firstMessage).toBe("Hello")
    })

    it("does not mutate the original session object", () => {
      const session = makeSession({ id: "s1", firstMessage: "Original" })
      const projects = [makeProject({ sessions: [session] })]
      updateSessionInProject(projects, "s1", (s) => ({ ...s, messageCount: 99 }))
      expect(session.firstMessage).toBe("Original")
      expect(session.messageCount).toBe(5)
    })

    it("does not mutate the original project object", () => {
      const project = makeProject({ sessions: [makeSession({ id: "s1" })] })
      const projects = [project]
      updateSessionInProject(projects, "s1", (s) => ({ ...s, messageCount: 10 }))
      expect(project.sessions[0].messageCount).toBe(5)
    })

    it("updates the correct session among multiple sessions", () => {
      const projects = [
        makeProject({
          sessions: [
            makeSession({ id: "s1", firstMessage: "First" }),
            makeSession({ id: "s2", firstMessage: "Second" }),
            makeSession({ id: "s3", firstMessage: "Third" }),
          ],
        }),
      ]
      const result = updateSessionInProject(projects, "s2", (s) => ({
        ...s,
        firstMessage: "Updated",
      }))
      expect(result[0].sessions[0].firstMessage).toBe("First")
      expect(result[0].sessions[1].firstMessage).toBe("Updated")
      expect(result[0].sessions[2].firstMessage).toBe("Third")
    })

    it("finds the session across multiple projects", () => {
      const projects = [
        makeProject({ id: "p1", sessions: [makeSession({ id: "s1" })] }),
        makeProject({ id: "p2", sessions: [makeSession({ id: "s2" })] }),
      ]
      const result = updateSessionInProject(projects, "s2", (s) => ({
        ...s,
        messageCount: 42,
      }))
      expect(result[0].sessions[0].messageCount).toBe(5)
      expect(result[1].sessions[0].messageCount).toBe(42)
    })
  })

  describe("when session is NOT found", () => {
    it("returns projects unchanged for non-existent session id", () => {
      const projects = [
        makeProject({ sessions: [makeSession({ id: "s1" })] }),
      ]
      const result = updateSessionInProject(projects, "nonexistent", (s) => ({
        ...s,
        firstMessage: "Nope",
      }))
      expect(result).toEqual(projects)
    })

    it("returns projects unchanged for empty projects array", () => {
      const projects: ProjectInfo[] = []
      const result = updateSessionInProject(projects, "s1", (s) => ({
        ...s,
        firstMessage: "Nope",
      }))
      expect(result).toEqual(projects)
    })

    it("returns projects unchanged for projects with no sessions", () => {
      const projects = [makeProject({ sessions: [] })]
      const result = updateSessionInProject(projects, "s1", (s) => ({
        ...s,
        firstMessage: "Nope",
      }))
      expect(result).toEqual(projects)
    })

    it("does not call the updater when session is not found", () => {
      const updater = vi.fn((s) => s)
      const projects = [makeProject({ sessions: [makeSession({ id: "s1" })] })]
      updateSessionInProject(projects, "missing", updater)
      expect(updater).not.toHaveBeenCalled()
    })
  })

  describe("updater receives the correct session", () => {
    it("passes the full session object to the updater", () => {
      const session = makeSession({ id: "s1", firstMessage: "Test", messageCount: 3 })
      const projects = [makeProject({ sessions: [session] })]
      const updater = vi.fn((s) => s)
      updateSessionInProject(projects, "s1", updater)
      expect(updater).toHaveBeenCalledOnce()
      expect(updater).toHaveBeenCalledWith(session)
    })
  })
})

describe("isPendingSession", () => {
  describe("returns true for pending session IDs", () => {
    it("identifies standard pending session ID format", () => {
      expect(isPendingSession("pending-1234567890-abc123")).toBe(true)
    })

    it("identifies pending session ID with minimal format", () => {
      expect(isPendingSession("pending-")).toBe(true)
    })

    it("identifies pending session ID with timestamp", () => {
      expect(isPendingSession("pending-1700000000000")).toBe(true)
    })

    it("identifies pending session ID with random suffix", () => {
      expect(isPendingSession("pending-abc123xyz")).toBe(true)
    })
  })

  describe("returns false for non-pending session IDs", () => {
    it("rejects regular session IDs", () => {
      expect(isPendingSession("sess-123")).toBe(false)
    })

    it("rejects UUID-style session IDs", () => {
      expect(isPendingSession("123e4567-e89b-12d3-a456-426614174000")).toBe(false)
    })

    it("rejects session IDs that start with similar but not exact prefix", () => {
      expect(isPendingSession("pending123")).toBe(false)
      expect(isPendingSession("Pending-123")).toBe(false)
      expect(isPendingSession("PENDING-123")).toBe(false)
      expect(isPendingSession("pending_123")).toBe(false)
    })

    it("rejects session IDs that contain pending but don't start with it", () => {
      expect(isPendingSession("session-pending-123")).toBe(false)
      expect(isPendingSession("not-pending-123")).toBe(false)
    })
  })

  describe("handles null and undefined", () => {
    it("returns false for null", () => {
      expect(isPendingSession(null)).toBe(false)
    })

    it("returns false for undefined", () => {
      expect(isPendingSession(undefined)).toBe(false)
    })
  })

  describe("type guard behavior", () => {
    it("narrows type to pending session ID when true", () => {
      const sessionId: string | null = "pending-123"
      if (isPendingSession(sessionId)) {
        // TypeScript should recognize sessionId as `pending-${string}`
        expect(sessionId.startsWith("pending-")).toBe(true)
      }
    })

    it("does not narrow type when false", () => {
      const sessionId: string | null = "sess-123"
      if (!isPendingSession(sessionId)) {
        // sessionId is still string | null
        expect(typeof sessionId === "string" || sessionId === null).toBe(true)
      }
    })
  })
})
