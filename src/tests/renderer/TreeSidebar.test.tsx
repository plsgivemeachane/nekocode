// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// ── Mock logger ────────────────────────────────────────────────────
vi.mock("@/renderer/src/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock project-store ────────────────────────────────────────────
const mockDispatch = vi.fn()
const mockCreateSession = vi.fn()
const mockReconnectSession = vi.fn()
const mockPreloadSession = vi.fn()
const mockAddProject = vi.fn()
const mockRemoveProject = vi.fn()
const mockRefreshSessions = vi.fn()
const mockSetActiveSession = vi.fn()

const mockProjectState = {
  projects: [],
  activeSessionId: null,
  activeProjectPath: "/test/project",
  sessionStatuses: {},
  preloadedHistory: {},
  agentReady: true,
}

vi.mock("@/renderer/src/stores/project-store", () => ({
  useProjectStore: vi.fn(() => ({
    state: mockProjectState,
    dispatch: mockDispatch,
    addProject: mockAddProject,
    removeProject: mockRemoveProject,
    reconnectSession: mockReconnectSession,
    createSession: mockCreateSession,
    refreshSessions: mockRefreshSessions,
    preloadSession: mockPreloadSession,
    setActiveSession: mockSetActiveSession,
  })),
}))

// ── Mock hooks ──────────────────────────────────────────────────────
vi.mock("@/renderer/src/hooks/useSessionOrchestration", () => ({
  useSessionOrchestration: () => ({
    createSession: mockCreateSession,
    reconnectSession: mockReconnectSession,
    preloadSession: mockPreloadSession,
  }),
}))

// ── Mock useClickOutside ────────────────────────────────────────────
vi.mock("@/renderer/src/hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}))

// ── Mock context-menu ────────────────────────────────────────────────
vi.mock("@/renderer/src/components/layout/context-menu", () => ({
  useContextMenu: () => ({
    show: vi.fn(),
    hide: vi.fn(),
  }),
}))

// ── Mock session deletion hook ───────────────────────────────────────
vi.mock("@/renderer/src/hooks/useSessionDeletion", () => ({
  useSessionDeletion: () => ({
    deleteSession: vi.fn(),
    deleteAllProjectSessions: vi.fn(),
  }),
}))

// Import after mocks
import { TreeSidebar } from "@/renderer/src/components/layout/TreeSidebar"
import type { ProjectInfo, SessionInfoDisplay } from "@/shared/ipc-types"

// ── Helpers ──────────────────────────────────────────────────────────
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
    path: overrides.path ?? "/test/project",
    sessions: overrides.sessions ?? [],
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("TreeSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectState.projects = []
    mockProjectState.activeSessionId = null
    mockProjectState.activeProjectPath = "/test/project"
    mockProjectState.sessionStatuses = {}
    mockCreateSession.mockClear()
    mockReconnectSession.mockClear()
    mockPreloadSession.mockClear()
  })

  describe("pending session handling", () => {
    beforeEach(() => {
      const pendingSession = makeSession({ id: "pending-123", firstMessage: "Connecting..." })
      const realSession = makeSession({ id: "sess-real", firstMessage: "Real Session" })
      mockProjectState.projects = [makeProject({ sessions: [pendingSession, realSession] })]
    })

    it("does not call reconnectSession when clicking on a pending session", async () => {
      render(<TreeSidebar />)
      
      // Find the pending session element by its text
      const pendingElement = screen.getByText("Connecting...")
      expect(pendingElement).toBeTruthy()
      
      // Click on the pending session
      fireEvent.click(pendingElement.closest("div")!)
      
      // reconnectSession should NOT be called for pending sessions
      expect(mockReconnectSession).not.toHaveBeenCalled()
    })

    it("calls reconnectSession when clicking on a real session", async () => {
      render(<TreeSidebar />)
      
      // Find the real session element by its text
      const realElement = screen.getByText("Real Session")
      expect(realElement).toBeTruthy()
      
      // Click on the real session
      fireEvent.click(realElement.closest("div")!)
      
      // reconnectSession should be called for real sessions
      expect(mockReconnectSession).toHaveBeenCalledWith("sess-real", "/test/project")
    })

    it("does not call preloadSession when hovering over a pending session", async () => {
      render(<TreeSidebar />)
      
      // Find the pending session element by its text
      const pendingElement = screen.getByText("Connecting...")
      expect(pendingElement).toBeTruthy()
      
      // Hover over the pending session
      fireEvent.mouseEnter(pendingElement.closest("div")!)
      
      // preloadSession should NOT be called for pending sessions
      expect(mockPreloadSession).not.toHaveBeenCalled()
    })

    it("calls preloadSession when hovering over a real session", async () => {
      render(<TreeSidebar />)
      
      // Find the real session element by its text
      const realElement = screen.getByText("Real Session")
      expect(realElement).toBeTruthy()
      
      // Hover over the real session
      fireEvent.mouseEnter(realElement.closest("div")!)
      
      // preloadSession should be called for real sessions
      expect(mockPreloadSession).toHaveBeenCalledWith("sess-real", "/test/project")
    })

    it("shows spinner for pending session instead of status dot", () => {
      render(<TreeSidebar />)
      
      // The pending session should have a spinner (SVG with animate-spin class)
      const pendingContainer = screen.getByText("Connecting...").closest("div")!
      const spinner = pendingContainer.querySelector("svg.animate-spin")
      expect(spinner).toBeTruthy()
    })

    it("applies cursor-wait class to pending session", () => {
      render(<TreeSidebar />)
      
      // The pending session container should have cursor-wait class
      const pendingContainer = screen.getByText("Connecting...").closest("div")!
      expect(pendingContainer.className).toContain("cursor-wait")
    })

    it("applies opacity-60 class to pending session", () => {
      render(<TreeSidebar />)
      
      // The pending session container should have opacity-60 class
      const pendingContainer = screen.getByText("Connecting...").closest("div")!
      expect(pendingContainer.className).toContain("opacity-60")
    })

    it("can click real sessions when a pending session exists", async () => {
      render(<TreeSidebar />)
      
      // First click on real session
      const realElement = screen.getByText("Real Session")
      fireEvent.click(realElement.closest("div")!)
      
      expect(mockReconnectSession).toHaveBeenCalledTimes(1)
      expect(mockReconnectSession).toHaveBeenCalledWith("sess-real", "/test/project")
      
      // Clear and click again to ensure pending session doesn't block interaction
      mockReconnectSession.mockClear()
      fireEvent.click(realElement.closest("div")!)
      
      expect(mockReconnectSession).toHaveBeenCalledTimes(1)
    })
  })

  describe("multiple pending sessions", () => {
    beforeEach(() => {
      const pending1 = makeSession({ id: "pending-111", firstMessage: "Connecting..." })
      const pending2 = makeSession({ id: "pending-222", firstMessage: "Loading..." })
      const real1 = makeSession({ id: "sess-real-1", firstMessage: "Session 1" })
      mockProjectState.projects = [makeProject({ sessions: [pending1, pending2, real1] })]
    })

    it("handles multiple pending sessions correctly", async () => {
      render(<TreeSidebar />)
      
      // Both pending sessions should be non-clickable
      const pendingElements = screen.getAllByText(/Connecting|Loading/)
      expect(pendingElements).toHaveLength(2)
      
      pendingElements.forEach(element => {
        fireEvent.click(element.closest("div")!)
      })
      
      // reconnectSession should not be called for any pending session
      expect(mockReconnectSession).not.toHaveBeenCalled()
    })

    it("allows clicking real sessions when multiple pending sessions exist", async () => {
      render(<TreeSidebar />)
      
      const realElement = screen.getByText("Session 1")
      fireEvent.click(realElement.closest("div")!)
      
      expect(mockReconnectSession).toHaveBeenCalledWith("sess-real-1", "/test/project")
    })
  })

  describe("active session highlighting with pending session", () => {
    beforeEach(() => {
      const pendingSession = makeSession({ id: "pending-123", firstMessage: "Connecting..." })
      const otherSession = makeSession({ id: "sess-other", firstMessage: "Other Session" })
      mockProjectState.projects = [makeProject({ sessions: [pendingSession, otherSession] })]
    })

    it("highlights pending session when it is the active session", () => {
      mockProjectState.activeSessionId = "pending-123"
      
      render(<TreeSidebar />)
      
      const pendingContainer = screen.getByText("Connecting...").closest("div")!
      expect(pendingContainer.className).toContain("bg-surface-800/80")
      expect(pendingContainer.className).toContain("text-text-primary")
    })

    it("highlights other session correctly when pending session is not active", () => {
      mockProjectState.activeSessionId = "sess-other"
      
      render(<TreeSidebar />)
      
      const otherContainer = screen.getByText("Other Session").closest("div")!
      expect(otherContainer.className).toContain("bg-surface-800/80")
      expect(otherContainer.className).toContain("text-text-primary")
      
      // Pending session should not be highlighted
      const pendingContainer = screen.getByText("Connecting...").closest("div")!
      expect(pendingContainer.className).not.toContain("bg-surface-800/80")
    })
  })
})
