import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { useSessionOrchestration } from "@/renderer/src/hooks/useSessionOrchestration"
import type { ExtensionLoadError } from "@/shared/ipc-types"

// ── Mock logger ────────────────────────────────────────────────────
const mockLogExtensionLoadWarnings = vi.hoisted(() => vi.fn())

vi.mock("@/renderer/src/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock("@/renderer/src/utils/extension-logging", () => ({
  logExtensionLoadWarnings: (...args: unknown[]) => mockLogExtensionLoadWarnings(...args),
}))

// ── Simple hook runner (mock react) ───────────────────────────────
let _refs = new Map<number, { current: unknown }>()
let _refIdCounter = 0

vi.mock("react", () => ({
  useRef: (initialValue: unknown) => {
    const id = _refIdCounter++
    if (!_refs.has(id)) _refs.set(id, { current: initialValue })
    return _refs.get(id)!
  },
  useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => [initial, vi.fn()],
}))

function resetHookState() {
  _refs = new Map()
  _refIdCounter = 0
}

function runInHookScope<R>(fn: () => R): R {
  resetHookState()
  return fn()
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeDispatch(): Mock {
  return vi.fn()
}

const SESSION_ID = "sess-abc123def456"
const PROJECT_PATH = "/test/project"

function setupNekocode(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal("nekocode", {
    session: {
      reconnect: overrides.reconnect ?? vi.fn().mockResolvedValue({
        history: [{ role: "user", content: "hello" }],
        extensionErrors: undefined,
        extensionsDisabled: false,
      }),
      create: overrides.create ?? vi.fn().mockResolvedValue({
        sessionId: SESSION_ID,
        extensionErrors: undefined,
        extensionsDisabled: false,
      }),
      loadHistory: overrides.loadHistory ?? vi.fn().mockResolvedValue([]),
    },
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useSessionOrchestration", () => {
  let dispatch: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    dispatch = makeDispatch()
    setupNekocode()
  })

  describe("reconnectSession", () => {
    it("dispatches SET_ACTIVE_SESSION and SET_AGENT_CONNECTING", async () => {
      const { reconnectSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE_SESSION", sessionId: SESSION_ID, projectPath: PROJECT_PATH })
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_CONNECTING" })
    })

    it("calls logExtensionLoadWarnings with mode=reconnect", async () => {
      const { reconnectSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(mockLogExtensionLoadWarnings).toHaveBeenCalledWith(
        "reconnect",
        SESSION_ID,
        undefined,
        false,
        expect.any(Function),
      )
    })

    it("dispatches SET_SESSION_MESSAGE_COUNT with history length", async () => {
      const { reconnectSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_SESSION_MESSAGE_COUNT",
        sessionId: SESSION_ID,
        messageCount: 1,
      })
    })

    it("dispatches SET_AGENT_READY on success", async () => {
      const { reconnectSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_READY", sessionId: SESSION_ID })
    })

    it("removes draft session when history has messages", async () => {
      const { reconnectSession, draftSessionsRef } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      draftSessionsRef.current.set(SESSION_ID, PROJECT_PATH)
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(draftSessionsRef.current.has(SESSION_ID)).toBe(false)
    })

    it("keeps draft session when history is empty and was runtime draft", async () => {
      setupNekocode({
        reconnect: vi.fn().mockResolvedValue({
          history: [],
          extensionErrors: undefined,
          extensionsDisabled: false,
        }),
      })
      const { reconnectSession, draftSessionsRef } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      draftSessionsRef.current.set(SESSION_ID, PROJECT_PATH)
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(draftSessionsRef.current.has(SESSION_ID)).toBe(true)
    })

    it("does NOT set draft when history is empty but was NOT a runtime draft", async () => {
      setupNekocode({
        reconnect: vi.fn().mockResolvedValue({
          history: [],
          extensionErrors: undefined,
          extensionsDisabled: false,
        }),
      })
      const { reconnectSession, draftSessionsRef } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(draftSessionsRef.current.has(SESSION_ID)).toBe(false)
    })

    it("dispatches UPDATE_SESSION_STATUS error and SET_AGENT_READY on failure", async () => {
      setupNekocode({
        reconnect: vi.fn().mockRejectedValue(new Error("reconnect failed")),
      })
      const { reconnectSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SESSION_STATUS", sessionId: SESSION_ID, status: "error" })
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_READY", sessionId: SESSION_ID })
    })

    it("onError callback from logExtensionLoadWarnings dispatches UPDATE_SESSION_STATUS", async () => {
      const errors: ExtensionLoadError[] = [{ path: "/ext", message: "fail" }]
      setupNekocode({
        reconnect: vi.fn().mockResolvedValue({
          history: [],
          extensionErrors: errors,
          extensionsDisabled: false,
        }),
      })
      // Make the mock actually invoke the onError callback
      mockLogExtensionLoadWarnings.mockImplementation(
        (_mode, _sessionId, _errs, _disabled, onError) => {
          onError?.("sess-abc123def456")
        },
      )
      const { reconnectSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await reconnectSession(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SESSION_STATUS", sessionId: SESSION_ID, status: "error" })
    })
  })

  describe("createSession", () => {
    it("skips creation if already in flight for same projectPath", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      // Call twice concurrently
      const p1 = createSession(PROJECT_PATH)
      const p2 = createSession(PROJECT_PATH)
      await Promise.all([p1, p2])
      expect(window.nekocode.session.create).toHaveBeenCalledOnce()
    })

    it("creates a new session via window.nekocode.session.create", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      expect(window.nekocode.session.create).toHaveBeenCalledWith(PROJECT_PATH)
    })

    it("dispatches SET_AGENT_CONNECTING immediately for optimistic UI", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_CONNECTING" })
    })

    it("dispatches SET_ACTIVE_SESSION with pending session immediately, then REPLACE_PENDING_SESSION", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      // First, SET_ACTIVE_SESSION is called with a pending ID
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SET_ACTIVE_SESSION",
          projectPath: PROJECT_PATH,
          sessionId: expect.stringMatching(/^pending-/),
        }),
      )
      // Then, REPLACE_PENDING_SESSION is called with the real session
      expect(dispatch).toHaveBeenCalledWith({
        type: "REPLACE_PENDING_SESSION",
        projectPath: PROJECT_PATH,
        pendingId: expect.stringMatching(/^pending-/),
        realSession: {
          id: SESSION_ID,
          firstMessage: "New session",
          created: expect.any(String),
          messageCount: 0,
        },
      })
    })

    it("dispatches SET_AGENT_READY with real session ID after creation", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_READY", sessionId: SESSION_ID })
    })

    it("tracks the new session as a draft", async () => {
      const { createSession, draftSessionsRef } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      expect(draftSessionsRef.current.get(SESSION_ID)).toBe(PROJECT_PATH)
    })

    it("calls logExtensionLoadWarnings with mode=create", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      expect(mockLogExtensionLoadWarnings).toHaveBeenCalledWith(
        "create",
        SESSION_ID,
        undefined,
        false,
        expect.any(Function),
      )
    })

    it("removes projectPath from in-flight set in finally block on success", async () => {
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      // Verify the create doesn't throw
      await createSession(PROJECT_PATH)
      // If finally didn't run, the ref would still have the path
      // We can't directly access createInFlightProjectsRef, but we can call again
      // and verify it doesn't skip
      await createSession(PROJECT_PATH)
      expect(window.nekocode.session.create).toHaveBeenCalledTimes(2)
    })

    it("removes projectPath from in-flight set in finally block on failure", async () => {
      setupNekocode({
        create: vi.fn().mockRejectedValue(new Error("create failed")),
      })
      const { createSession } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await createSession(PROJECT_PATH)
      // Should not throw — error is caught internally
      // Verify we can call again after failure (finally cleaned up)
      setupNekocode()
      await createSession(PROJECT_PATH)
      expect(window.nekocode.session.create).toHaveBeenCalledTimes(1)
    })

    describe("active draft reuse", () => {
      it("reuses active draft when activeSessionId matches projectPath and draft ref matches", async () => {
        const { createSession, draftSessionsRef } = runInHookScope(() =>
          useSessionOrchestration({ dispatch, activeSessionId: SESSION_ID, activeProjectPath: PROJECT_PATH }),
        )
        draftSessionsRef.current.set(SESSION_ID, PROJECT_PATH)
        await createSession(PROJECT_PATH)
        expect(window.nekocode.session.loadHistory).toHaveBeenCalledWith(SESSION_ID)
        expect(window.nekocode.session.create).not.toHaveBeenCalled()
        expect(dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE_SESSION", sessionId: SESSION_ID, projectPath: PROJECT_PATH })
      })

      it("creates fresh session when active draft has history", async () => {
        setupNekocode({
          loadHistory: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
        })
        const { createSession, draftSessionsRef } = runInHookScope(() =>
          useSessionOrchestration({ dispatch, activeSessionId: SESSION_ID, activeProjectPath: PROJECT_PATH }),
        )
        draftSessionsRef.current.set(SESSION_ID, PROJECT_PATH)
        await createSession(PROJECT_PATH)
        expect(window.nekocode.session.create).toHaveBeenCalledWith(PROJECT_PATH)
        // The fresh create path re-tracks the session as a draft
        expect(draftSessionsRef.current.has(SESSION_ID)).toBe(true)
      })

      it("creates fresh session when loadHistory throws", async () => {
        setupNekocode({
          loadHistory: vi.fn().mockRejectedValue(new Error("load failed")),
        })
        const { createSession, draftSessionsRef } = runInHookScope(() =>
          useSessionOrchestration({ dispatch, activeSessionId: SESSION_ID, activeProjectPath: PROJECT_PATH }),
        )
        draftSessionsRef.current.set(SESSION_ID, PROJECT_PATH)
        await createSession(PROJECT_PATH)
        expect(window.nekocode.session.create).toHaveBeenCalledWith(PROJECT_PATH)
        // The fresh create path re-tracks the session as a draft
        expect(draftSessionsRef.current.has(SESSION_ID)).toBe(true)
      })

      it("does NOT attempt draft reuse when activeSessionId is null", async () => {
        const { createSession } = runInHookScope(() =>
          useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: PROJECT_PATH }),
        )
        await createSession(PROJECT_PATH)
        expect(window.nekocode.session.loadHistory).not.toHaveBeenCalled()
        expect(window.nekocode.session.create).toHaveBeenCalledWith(PROJECT_PATH)
      })

      it("does NOT attempt draft reuse when activeProjectPath differs", async () => {
        const { createSession, draftSessionsRef } = runInHookScope(() =>
          useSessionOrchestration({ dispatch, activeSessionId: SESSION_ID, activeProjectPath: "/other/path" }),
        )
        draftSessionsRef.current.set(SESSION_ID, PROJECT_PATH)
        await createSession(PROJECT_PATH)
        expect(window.nekocode.session.loadHistory).not.toHaveBeenCalled()
        expect(window.nekocode.session.create).toHaveBeenCalledWith(PROJECT_PATH)
      })

      it("does NOT attempt draft reuse when draftSessionsRef doesn't match", async () => {
        const { createSession, draftSessionsRef } = runInHookScope(() =>
          useSessionOrchestration({ dispatch, activeSessionId: SESSION_ID, activeProjectPath: PROJECT_PATH }),
        )
        draftSessionsRef.current.set(SESSION_ID, "/different/path")
        await createSession(PROJECT_PATH)
        expect(window.nekocode.session.loadHistory).not.toHaveBeenCalled()
        expect(window.nekocode.session.create).toHaveBeenCalledWith(PROJECT_PATH)
      })
    })
  })

  describe("initReconnect", () => {
    it("dispatches SET_AGENT_CONNECTING and SET_ACTIVE_SESSION", async () => {
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_CONNECTING" })
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE_SESSION", sessionId: SESSION_ID, projectPath: PROJECT_PATH })
    })

    it("dispatches SET_SESSION_MESSAGE_COUNT with history length", async () => {
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_SESSION_MESSAGE_COUNT",
        sessionId: SESSION_ID,
        messageCount: 1,
      })
    })

    it("dispatches PRELOAD_HISTORY when history has messages", async () => {
      const history = [{ role: "user", content: "hello" }]
      setupNekocode({
        reconnect: vi.fn().mockResolvedValue({
          history,
          extensionErrors: undefined,
          extensionsDisabled: false,
        }),
      })
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({
        type: "PRELOAD_HISTORY",
        sessionId: SESSION_ID,
        messages: history,
      })
    })

    it("does NOT dispatch PRELOAD_HISTORY when history is empty", async () => {
      setupNekocode({
        reconnect: vi.fn().mockResolvedValue({
          history: [],
          extensionErrors: undefined,
          extensionsDisabled: false,
        }),
      })
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      const preloadCalls = dispatch.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === "PRELOAD_HISTORY")
      expect(preloadCalls).toHaveLength(0)
    })

    it("dispatches SET_AGENT_READY on success", async () => {
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_READY", sessionId: SESSION_ID })
    })

    it("calls logExtensionLoadWarnings with mode=reconnect", async () => {
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      expect(mockLogExtensionLoadWarnings).toHaveBeenCalledWith(
        "reconnect",
        SESSION_ID,
        undefined,
        false,
        expect.any(Function),
      )
    })

    it("dispatches UPDATE_SESSION_STATUS error and SET_AGENT_READY on failure", async () => {
      setupNekocode({
        reconnect: vi.fn().mockRejectedValue(new Error("init reconnect failed")),
      })
      const { initReconnect } = runInHookScope(() =>
        useSessionOrchestration({ dispatch, activeSessionId: null, activeProjectPath: null }),
      )
      await initReconnect(SESSION_ID, PROJECT_PATH)
      expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SESSION_STATUS", sessionId: SESSION_ID, status: "error" })
      expect(dispatch).toHaveBeenCalledWith({ type: "SET_AGENT_READY", sessionId: SESSION_ID })
    })
  })
})
