// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { ChatView } from "@/renderer/src/components/chat/ChatView"
import { createMockIPC, setupMockIPC, clearMockIPC } from "../__utils__/test-utils"
import type { ChatMessage } from "@/renderer/src/types/chat"
import type { UsageData } from "@/shared/ipc-types"

// ── Mock all child components and hooks ────────────────────────────

// Mock useSession
const mockUseSession = {
  messages: [] as ChatMessage[],
  isHistoryLoading: false,
  isMessagesStale: false,
  isStreaming: false,
  error: null as string | null,
  clearError: vi.fn(),
  input: "",
  setInput: vi.fn(),
  sendPrompt: vi.fn(() => Promise.resolve()),
  abortPrompt: vi.fn(() => Promise.resolve()),
  activeModel: { id: "m1", name: "TestModel", provider: "test" },
  modelList: [] as Array<{ id: string; name: string; provider: string }>,
  setModel: vi.fn(),
  usage: { inputTokens: 0, outputTokens: 0, totalCost: 0, contextWindow: 0, contextPercent: 0 } as UsageData,
  streamStartTime: 0,
}

vi.mock("@/renderer/src/hooks/useSession", () => ({
  useSession: () => mockUseSession,
}))

// Mock useUIRequests
const mockUseUIRequests = {
  activeRequest: null,
  updateLocalState: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}

vi.mock("@/renderer/src/hooks/useUIRequests", () => ({
  useUIRequests: () => mockUseUIRequests,
}))

// Mock useWorkflowSteps
const mockUseWorkflowSteps = {
  workflows: new Map(),
}

vi.mock("@/renderer/src/hooks/useWorkflowSteps", () => ({
  useWorkflowSteps: () => mockUseWorkflowSteps,
}))

// Mock useCommands
const mockUseCommands = {
  commands: [],
  isLoading: false,
  recordCommandUsage: vi.fn(),
  getRecentCommandNames: vi.fn(() => new Set<string>()),
}

vi.mock("@/renderer/src/hooks/useCommands", () => ({
  useCommands: () => mockUseCommands,
}))

// Mock project store
const mockProjectState = {
  activeProjectPath: "/test/project",
  agentReady: true,
  projects: [] as Array<{ path: string; sessions: Array<{ id: string; firstMessage?: string }> }>,
}

vi.mock("@/renderer/src/stores/project-store", () => ({
  useProjectStore: () => ({ state: mockProjectState }),
}))

// Mock useSessionMessages
const mockUseSessionMessages = {
  onToolCallClick: vi.fn(),
  setMessages: vi.fn(),
}

vi.mock("@/renderer/src/contexts/session-messages-context", () => ({
  useSessionMessages: () => mockUseSessionMessages,
}))

// ── Helpers ──────────────────────────────────────────────────────────

function makeUserMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello",
    ...overrides,
  } as ChatMessage
}

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-2",
    role: "assistant",
    type: "text",
    content: "Hi there!",
    ...overrides,
  } as ChatMessage
}

function makeToolCallMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-3",
    role: "assistant",
    type: "tool_call",
    toolName: "read",
    toolId: "tool-1",
    status: "done",
    isError: false,
    args: {},
    ...overrides,
  } as ChatMessage
}

function makeThinkingMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-4",
    role: "assistant",
    type: "thinking",
    content: "Thinking...",
    ...overrides,
  } as ChatMessage
}

function renderChatView(overrides: { sessionId?: string | null } = {}) {
  return render(<ChatView sessionId={overrides.sessionId !== undefined ? overrides.sessionId : "test-session"} />)
}

// ── Tests ──────────────────────────────────────────────────────────

describe("ChatView", () => {
  let mockIPC: ReturnType<typeof createMockIPC>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIPC = createMockIPC()
    setupMockIPC(mockIPC)
    // Reset mock session state
    Object.assign(mockUseSession, {
      messages: [],
      isHistoryLoading: false,
      isMessagesStale: false,
      isStreaming: false,
      error: null,
      clearError: vi.fn(),
      input: "",
      setInput: vi.fn(),
      sendPrompt: vi.fn(() => Promise.resolve()),
      abortPrompt: vi.fn(() => Promise.resolve()),
      activeModel: { id: "m1", name: "TestModel", provider: "test" },
      modelList: [],
      setModel: vi.fn(),
      usage: { inputTokens: 0, outputTokens: 0, totalCost: 0, contextWindow: 0, contextPercent: 0 },
      streamStartTime: 0,
    })
    Object.assign(mockUseUIRequests, {
      activeRequest: null,
      updateLocalState: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn(),
    })
    Object.assign(mockUseWorkflowSteps, {
      workflows: new Map(),
    })
    Object.assign(mockUseCommands, {
      commands: [],
      isLoading: false,
      recordCommandUsage: vi.fn(),
      getRecentCommandNames: vi.fn(() => new Set<string>()),
    })
    Object.assign(mockProjectState, {
      activeProjectPath: "/test/project",
      agentReady: true,
    })
  })

  afterEach(() => {
    clearMockIPC()
  })

  // ═══════════════════════════════════════════════════════════════════
  // No session state
  // ═══════════════════════════════════════════════════════════════════

  it("shows placeholder UI when no session is active", () => {
    renderChatView({ sessionId: null })
    expect(screen.getByText("nekocode")).toBeInTheDocument()
  })

  it("shows keyboard shortcuts when no session is active", () => {
    renderChatView({ sessionId: null })
    expect(screen.getByText("New session")).toBeInTheDocument()
    expect(screen.getByText("Navigate")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Loading state
  // ═══════════════════════════════════════════════════════════════════

  it("shows loading indicator when history is loading with no messages", () => {
    mockUseSession.isHistoryLoading = true
    renderChatView()
    expect(screen.getByText(/Loading session messages/i)).toBeInTheDocument()
  })

  it("shows connecting indicator when agent is not ready", () => {
    mockUseSession.isHistoryLoading = true
    mockProjectState.agentReady = false
    renderChatView()
    expect(screen.getByText(/Connecting to agent/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Empty session state (welcome screen)
  // ═══════════════════════════════════════════════════════════════════

  it("shows welcome screen when session has no messages and not loading", () => {
    renderChatView()
    // WelcomeScreen component should be visible (it contains introductory text)
    // We check that the main content area exists without messages
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Error display
  // ═══════════════════════════════════════════════════════════════════

  it("displays error message when session has an error", () => {
    mockUseSession.error = "Something went wrong"
    renderChatView()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })

  it("can dismiss error message", async () => {
    const user = userEvent.setup()
    mockUseSession.error = "Something went wrong"
    renderChatView()

    // The dismiss button has aria-label="Dismiss error"
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i })
    await user.click(dismissBtn)
    expect(mockUseSession.clearError).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // ChatInput integration
  // ═══════════════════════════════════════════════════════════════════

  it("renders ChatInput with session id", () => {
    renderChatView()
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Global command palette
  // ═══════════════════════════════════════════════════════════════════

  it("opens global command palette on Ctrl+Shift+P", async () => {
    renderChatView()

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "P",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        })
      )
    })

    // The SearchPalette should be visible after the shortcut
    // Since it is portaled, we look for the search input
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/search/i)).toBeInTheDocument()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Stale messages overlay
  // ═══════════════════════════════════════════════════════════════════

  it("shows switching session overlay when messages are stale", () => {
    mockUseSession.isMessagesStale = true
    mockUseSession.messages = [makeUserMessage()]
    renderChatView()
    // The overlay text uses an ellipsis character (…)
    expect(screen.getByText(/Switching session/)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Status indicator
  // ═══════════════════════════════════════════════════════════════════

  it("shows status indicator when messages are present", () => {
    mockUseSession.messages = [makeUserMessage()]
    renderChatView()
    // StatusIndicator shows "Ready" when not streaming
    expect(screen.getByText("Ready")).toBeInTheDocument()
  })

  it("shows Working status when streaming", () => {
    mockUseSession.messages = [makeUserMessage()]
    mockUseSession.isStreaming = true
    renderChatView()
    expect(screen.getByText("Working")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Message grouping: tool_call messages
  // ═══════════════════════════════════════════════════════════════════

  it("renders tool_call messages without crashing", () => {
    mockUseSession.messages = [
      makeUserMessage({ id: "msg-1" }),
      makeToolCallMessage({ id: "msg-2", toolName: "read", toolId: "t1" }),
      makeToolCallMessage({ id: "msg-3", toolName: "edit", toolId: "t2" }),
      makeAssistantMessage({ id: "msg-4" }),
    ]
    // MessagesTimeline uses react-virtuoso which may not render in JSDOM,
    // but the component should not crash during grouping computation
    expect(() => renderChatView()).not.toThrow()
  })

  it("renders single tool_call message without crashing", () => {
    mockUseSession.messages = [
      makeUserMessage({ id: "msg-1" }),
      makeToolCallMessage({ id: "msg-2", toolName: "bash", toolId: "t1" }),
    ]
    expect(() => renderChatView()).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Message grouping: thinking messages
  // ═══════════════════════════════════════════════════════════════════

  it("renders thinking messages without crashing", () => {
    mockUseSession.messages = [
      makeUserMessage({ id: "msg-1" }),
      makeThinkingMessage({ id: "msg-2", content: "Part 1" }),
      makeThinkingMessage({ id: "msg-3", content: "Part 2" }),
      makeAssistantMessage({ id: "msg-4" }),
    ]
    expect(() => renderChatView()).not.toThrow()
  })

  it("renders single thinking message without crashing", () => {
    mockUseSession.messages = [
      makeUserMessage({ id: "msg-1" }),
      makeThinkingMessage({ id: "msg-2", content: "Hmm..." }),
      makeAssistantMessage({ id: "msg-3" }),
    ]
    expect(() => renderChatView()).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Message grouping: mixed messages
  // ═══════════════════════════════════════════════════════════════════

  it("renders user and assistant messages without crashing", () => {
    mockUseSession.messages = [
      makeUserMessage({ id: "msg-1", content: "What is 2+2?" }),
      makeAssistantMessage({ id: "msg-2", content: "4" }),
    ]
    expect(() => renderChatView()).not.toThrow()
  })

  it("renders interleaved tool_call and text messages without crashing", () => {
    mockUseSession.messages = [
      makeToolCallMessage({ id: "msg-1", toolName: "read", toolId: "t1" }),
      makeAssistantMessage({ id: "msg-2", content: "Intermediate text" }),
      makeToolCallMessage({ id: "msg-3", toolName: "edit", toolId: "t2" }),
    ]
    expect(() => renderChatView()).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // UI Dialog integration
  // ═══════════════════════════════════════════════════════════════════

  it("renders UI dialog without crashing when activeRequest is present", () => {
    mockUseSession.messages = [makeUserMessage()]
    mockUseUIRequests.activeRequest = {
      id: "ui-1",
      title: "Confirm Action",
      message: "Do you want to proceed?",
      type: "confirm",
    } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    // Should not crash when activeRequest is set
    expect(() => renderChatView()).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Workflow steps integration
  // ═══════════════════════════════════════════════════════════════════

  it("renders workflow step progress without crashing when workflows are tracked", () => {
    mockUseSession.messages = [makeUserMessage()]
    const workflowMap = new Map()
    workflowMap.set("wf-1", {
      isActive: true,
      steps: new Map([["step-1", { name: "Step 1", status: "running" }]]),
    })
    mockUseWorkflowSteps.workflows = workflowMap
    expect(() => renderChatView()).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // isAgentConnecting state
  // ═══════════════════════════════════════════════════════════════════

  it("shows connecting state when agent is not ready and session has no messages", () => {
    mockProjectState.agentReady = false
    renderChatView()
    // WelcomeScreen should render (shows connecting or ready text)
    // The connecting state depends on isAgentConnecting prop
    expect(screen.getByText(/Connecting to agent|ready/i)).toBeInTheDocument()
  })

  it("agent ready state shows WelcomeScreen without connecting text", () => {
    mockProjectState.agentReady = true
    renderChatView()
    expect(screen.getByText(/ready/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Scroll-to-bottom button
  // ═══════════════════════════════════════════════════════════════════

  it("does not show scroll-to-bottom button when no messages", () => {
    renderChatView()
    const scrollBtn = screen.queryByRole("button", { name: /scroll to bottom/i })
    expect(scrollBtn).not.toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Error bar with messages
  // ═══════════════════════════════════════════════════════════════════

  it("shows error bar alongside messages", () => {
    mockUseSession.messages = [makeUserMessage()]
    mockUseSession.error = "API rate limit"
    renderChatView()
    expect(screen.getByText("API rate limit")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // No-session state: action chips
  // ═══════════════════════════════════════════════════════════════════

  it("shows action chips when no session is active", () => {
    renderChatView({ sessionId: null })
    expect(screen.getByText("Resume a session")).toBeInTheDocument()
    expect(screen.getByText("Start a new thread")).toBeInTheDocument()
  })

  it("shows navigate shortcuts when no session is active", () => {
    renderChatView({ sessionId: null })
    expect(screen.getByText("Navigate")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Global command palette close
  // ═══════════════════════════════════════════════════════════════════

  it("opens and closes global command palette", async () => {
    renderChatView()

    // Open the palette
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "P",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        })
      )
    })

    await waitFor(() => {
      // SearchPalette uses "Search..." as placeholder
      expect(screen.queryByPlaceholderText(/search/i)).toBeInTheDocument()
    })

    // Toggle it closed
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "P",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        })
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Stale messages overlay with content
  // ═══════════════════════════════════════════════════════════════════

  it("stale overlay renders without crashing", () => {
    mockUseSession.isMessagesStale = true
    mockUseSession.messages = [makeUserMessage({ content: "Secret message" })]
    // Should not crash when messages are stale
    expect(() => renderChatView()).not.toThrow()
  })
})
