// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { SessionView } from "@/renderer/src/components/session/SessionView"
import { createMockIPC, setupMockIPC, clearMockIPC } from "../__utils__/test-utils"
import type { ChatMessage } from "@/renderer/src/types/chat"

// ── Mock useSession ────────────────────────────────────────────────

const mockUseSession = {
  isStreaming: false,
  messages: [] as ChatMessage[],
  error: null as string | null,
  sendPrompt: vi.fn(() => Promise.resolve()),
  abortPrompt: vi.fn(() => Promise.resolve()),
  input: "",
  setInput: vi.fn(),
  activeModel: { id: "m1", name: "TestModel", provider: "test" },
  modelList: [] as Array<{ id: string; name: string; provider: string }>,
  setModel: vi.fn(),
}

vi.mock("@/renderer/src/hooks/useSession", () => ({
  useSession: () => mockUseSession,
}))

// ── Helpers ──────────────────────────────────────────────────────────

const defaultProps = {
  sessionId: "test-session",
  cwd: "/test/project",
  onCreateSession: vi.fn(() => Promise.resolve()),
  onDisposeSession: vi.fn(() => Promise.resolve()),
}

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

function renderSessionView(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  return render(<SessionView {...props} />)
}

// ── Tests ──────────────────────────────────────────────────────────

describe("SessionView", () => {
  let mockIPC: ReturnType<typeof createMockIPC>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIPC = createMockIPC()
    setupMockIPC(mockIPC)
    Object.assign(mockUseSession, {
      isStreaming: false,
      messages: [],
      error: null,
      sendPrompt: vi.fn(() => Promise.resolve()),
      abortPrompt: vi.fn(() => Promise.resolve()),
      input: "",
      setInput: vi.fn(),
      activeModel: { id: "m1", name: "TestModel", provider: "test" },
      modelList: [],
      setModel: vi.fn(),
    })
  })

  afterEach(() => {
    clearMockIPC()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Header
  // ═══════════════════════════════════════════════════════════════════

  it("renders the NekoCode header", () => {
    renderSessionView()
    expect(screen.getByText("Neko")).toBeInTheDocument()
    expect(screen.getByText("code")).toBeInTheDocument()
  })

  it("shows the cwd in the header", () => {
    renderSessionView({ cwd: "/my/project" })
    expect(screen.getByText("/my/project")).toBeInTheDocument()
  })

  it("renders New Session button", () => {
    renderSessionView()
    // The button shows "New Session" text
    expect(screen.getByRole("button", { name: /new session/i })).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // New Session interaction
  // ═══════════════════════════════════════════════════════════════════

  it("calls onDisposeSession then onCreateSession when New Session is clicked", async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn(() => Promise.resolve())
    const onDisposeSession = vi.fn(() => Promise.resolve())
    renderSessionView({ onCreateSession, onDisposeSession })

    // Find the "New Session" button in the header
    const newSessionBtn = screen.getByRole("button", { name: /new session/i })
    await user.click(newSessionBtn)

    expect(onDisposeSession).toHaveBeenCalled()
    expect(onCreateSession).toHaveBeenCalled()
  })

  it("disables New Session button when streaming", () => {
    mockUseSession.isStreaming = true
    renderSessionView()
    const newSessionBtn = screen.getByRole("button", { name: /new session/i })
    expect(newSessionBtn).toBeDisabled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // No session state
  // ═══════════════════════════════════════════════════════════════════

  it("shows prompt to select project when no session is active", () => {
    renderSessionView({ sessionId: "" })
    // When no session, shows "Click New Session to select a project folder."
    expect(screen.getByText(/Click.*New Session.*to select a project folder/)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Message display
  // ═══════════════════════════════════════════════════════════════════

  it("shows welcome screen when session has no messages", () => {
    renderSessionView()
    // When there are no messages, WelcomeScreen is rendered
    // It contains the input placeholder
    expect(screen.getByPlaceholderText(/Ask anything/)).toBeInTheDocument()
  })

  it("displays user messages as pre-formatted text", () => {
    mockUseSession.messages = [
      makeUserMessage({ content: "Hello from user" }),
    ]
    renderSessionView()
    // User messages are rendered as <pre> tags with the content
    const preElement = screen.getByText("Hello from user")
    expect(preElement.tagName).toBe("PRE")
  })

  it("displays assistant text messages as pre-formatted text", () => {
    mockUseSession.messages = [
      makeAssistantMessage({ content: "Hello from assistant" }),
    ]
    renderSessionView()
    const preElement = screen.getByText("Hello from assistant")
    expect(preElement.tagName).toBe("PRE")
  })

  it("displays thinking messages with [Thinking:] prefix and truncation", () => {
    const longContent = "A".repeat(100)
    mockUseSession.messages = [
      {
        id: "msg-think",
        role: "assistant",
        type: "thinking",
        content: longContent,
      } as ChatMessage,
    ]
    renderSessionView()
    // Thinking messages are formatted as: [Thinking: first 80 chars...]
    expect(screen.getByText(/\[Thinking: A{80}\.\.\.\]/)).toBeInTheDocument()
  })

  it("displays tool call messages with name and status", () => {
    mockUseSession.messages = [
      {
        id: "msg-tool",
        role: "assistant",
        type: "tool_call",
        toolName: "read",
        status: "done",
        isError: false,
        args: {},
      } as ChatMessage,
    ]
    renderSessionView()
    // Tool calls are formatted as: [toolName (done)] or [toolName (error)]
    expect(screen.getByText(/\[read \(done\)\]/)).toBeInTheDocument()
  })

  it("displays tool call messages with error status", () => {
    mockUseSession.messages = [
      {
        id: "msg-tool-err",
        role: "assistant",
        type: "tool_call",
        toolName: "write",
        status: "done",
        isError: true,
        args: {},
      } as ChatMessage,
    ]
    renderSessionView()
    expect(screen.getByText(/\[write \(error\)\]/)).toBeInTheDocument()
  })

  it("displays running tool calls with ellipsis", () => {
    mockUseSession.messages = [
      {
        id: "msg-tool-run",
        role: "assistant",
        type: "tool_call",
        toolName: "bash",
        status: "running",
        isError: false,
        args: {},
      } as ChatMessage,
    ]
    renderSessionView()
    expect(screen.getByText(/\[bash\.\.\.\]/)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Error display
  // ═══════════════════════════════════════════════════════════════════

  it("shows error when session has an error", () => {
    mockUseSession.error = "Connection failed"
    renderSessionView()
    expect(screen.getByText("Connection failed")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Streaming indicator
  // ═══════════════════════════════════════════════════════════════════

  it("shows streaming cursor when streaming with messages", () => {
    mockUseSession.messages = [makeUserMessage()]
    mockUseSession.isStreaming = true
    renderSessionView()
    // The streaming cursor has animate-glow-pulse class
    expect(document.querySelector(".animate-glow-pulse")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Input controls
  // ═══════════════════════════════════════════════════════════════════

  it("disables input when no session is active", () => {
    renderSessionView({ sessionId: "" })
    // When sessionId is empty, the input is visible but should show "Click New Session" instead
    // Actually, the input is in the footer which still renders
    const input = screen.getByPlaceholderText(/Ask anything/)
    expect(input).toBeDisabled()
  })

  it("disables input when streaming", () => {
    mockUseSession.isStreaming = true
    renderSessionView()
    expect(screen.getByPlaceholderText(/Ask anything/)).toBeDisabled()
  })

  it("shows send button when not streaming", () => {
    renderSessionView()
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument()
  })

  it("shows stop button when streaming", () => {
    mockUseSession.isStreaming = true
    renderSessionView()
    expect(screen.getByRole("button", { name: /stop response/i })).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Model dropdown
  // ═══════════════════════════════════════════════════════════════════

  it("shows model dropdown when model button is clicked", async () => {
    const user = userEvent.setup()
    mockUseSession.modelList = [
      { id: "m1", name: "TestModel", provider: "test" },
      { id: "m2", name: "OtherModel", provider: "other" },
    ]
    renderSessionView()

    // Click the model button (contains the model name)
    await user.click(screen.getByText("TestModel"))

    // Other model should appear in dropdown
    expect(screen.getByText("OtherModel")).toBeInTheDocument()
  })

  it("selects a model from the dropdown", async () => {
    const user = userEvent.setup()
    const setModel = vi.fn()
    mockUseSession.modelList = [
      { id: "m1", name: "TestModel", provider: "test" },
      { id: "m2", name: "OtherModel", provider: "other" },
    ]
    mockUseSession.setModel = setModel
    renderSessionView()

    await user.click(screen.getByText("TestModel"))
    await user.click(screen.getByText("OtherModel"))

    expect(setModel).toHaveBeenCalledWith("other", "m2")
  })
})
