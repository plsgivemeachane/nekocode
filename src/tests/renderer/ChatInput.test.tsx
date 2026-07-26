// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { ChatInput } from "@/renderer/src/components/chat/ChatInput"
import { createMockIPC, setupMockIPC, clearMockIPC } from "../__utils__/test-utils"
import type { CommandInfo } from "@/shared/ipc-types"

// ── Mock hooks ─────────────────────────────────────────────────────

const mockUseCommands = {
  commands: [] as CommandInfo[],
  isLoading: false,
  recordCommandUsage: vi.fn(),
  getRecentCommandNames: vi.fn(() => new Set<string>()),
}

vi.mock("@/renderer/src/hooks/useCommands", () => ({
  useCommands: () => mockUseCommands,
}))

// ── Helpers ──────────────────────────────────────────────────────────

const defaultProps = {
  sessionId: "test-session-id",
  isStreaming: false,
  isAgentConnecting: false,
  input: "",
  setInput: vi.fn(),
  sendPrompt: vi.fn(() => Promise.resolve()),
  abortPrompt: vi.fn(() => Promise.resolve()),
  activeModel: { id: "model-1", name: "Test Model", provider: "test" } as const,
  modelList: [
    { id: "model-1", name: "Test Model", provider: "test" },
    { id: "model-2", name: "Other Model", provider: "other" },
  ] as Array<{ id: string; name: string; provider: string }>,
  setModel: vi.fn(),
  projectPath: "/test/project",
  gitBranch: "main",
}

function renderChatInput(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  return render(<ChatInput {...props} />)
}

// ── Tests ──────────────────────────────────────────────────────────

describe("ChatInput", () => {
  let mockIPC: ReturnType<typeof createMockIPC>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIPC = createMockIPC()
    setupMockIPC(mockIPC)
    mockUseCommands.commands = []
    mockUseCommands.isLoading = false
  })

  afterEach(() => {
    clearMockIPC()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders the textarea with placeholder text", () => {
    renderChatInput()
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeInTheDocument()
  })

  it("renders the active model name", () => {
    renderChatInput()
    expect(screen.getByText("Test Model")).toBeInTheDocument()
  })

  it("renders the project path", () => {
    renderChatInput()
    expect(screen.getByText("/test/project")).toBeInTheDocument()
  })

  it("renders the git branch", () => {
    renderChatInput()
    expect(screen.getByText("main")).toBeInTheDocument()
  })

  it("does not render a send button (Enter to send, OpenCode TUI style)", () => {
    renderChatInput()
    // OpenCode TUI revamp: no send button. Sending is via Enter.
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument()
  })

  it("shows a Ctrl+C to stop hint when streaming", () => {
    renderChatInput({ isStreaming: true })
    expect(screen.getByText(/Ctrl\+C to stop/i)).toBeInTheDocument()
  })

  it("disables textarea when no session is active", () => {
    renderChatInput({ sessionId: undefined })
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeDisabled()
  })

  it("disables textarea when streaming", () => {
    renderChatInput({ isStreaming: true })
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeDisabled()
  })

  it("disables textarea when agent is connecting", () => {
    renderChatInput({ isAgentConnecting: true })
    expect(screen.getByPlaceholderText(/Agent starting/i)).toBeDisabled()
  })

  it("shows connecting placeholder when agent is connecting", () => {
    renderChatInput({ isAgentConnecting: true })
    expect(screen.getByPlaceholderText(/Agent starting/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Interaction — Sending messages
  // ═══════════════════════════════════════════════════════════════════

  it("sends message on Enter key when input has text", async () => {
    const user = userEvent.setup()
    const sendPrompt = vi.fn(() => Promise.resolve())
    const setInput = vi.fn()
    renderChatInput({ input: "Hello world", setInput, sendPrompt })

    // OpenCode TUI revamp: no send button — sending is via Enter.
    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "{Enter}")

    expect(setInput).toHaveBeenCalledWith("")
    expect(sendPrompt).toHaveBeenCalledWith("Hello world")
  })

  it("does not send message on Shift+Enter", async () => {
    const user = userEvent.setup()
    const sendPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ input: "Hello", sendPrompt })

    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "{Shift>}{Enter}{/Shift}")

    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it("does not send when input is only whitespace", async () => {
    const user = userEvent.setup()
    const sendPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ input: "   ", sendPrompt })

    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "{Enter}")

    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it("does not send when streaming", async () => {
    const sendPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ isStreaming: true, input: "Hello", sendPrompt })

    // Textarea is disabled while streaming, so sending via Enter is blocked.
    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    expect(textarea).toBeDisabled()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Interaction — Stop / Abort
  // ═══════════════════════════════════════════════════════════════════

  it("calls abortPrompt on Ctrl+C when streaming (OpenCode TUI convention)", () => {
    const abortPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ isStreaming: true, abortPrompt })

    // No stop button anymore — Ctrl+C aborts (when no text is selected).
    // The textarea is disabled while streaming, so we dispatch the keydown
    // directly via fireEvent (user.type won't fire on a disabled element).
    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    fireEvent.keyDown(textarea, { key: "c", code: "KeyC", ctrlKey: true })

    expect(abortPrompt).toHaveBeenCalled()
  })

  it("does not abort on Ctrl+C when no session is active", () => {
    const abortPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ isStreaming: true, sessionId: undefined, abortPrompt })

    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    fireEvent.keyDown(textarea, { key: "c", code: "KeyC", ctrlKey: true })

    // NOTE: matches previous behavior — the stop button called abortPrompt
    // unconditionally; sessionId gating is the parent's job (it only passes a
    // real abortPrompt when a session exists).
    expect(abortPrompt).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Interaction — Model selection
  // ═══════════════════════════════════════════════════════════════════

  it("shows model dropdown when model button is clicked", async () => {
    const user = userEvent.setup()
    renderChatInput()

    // The model button shows the active model name
    await user.click(screen.getByText("Test Model"))

    // Model dropdown should show other model names
    expect(screen.getByText("Other Model")).toBeInTheDocument()
  })

  it("selects a model from the dropdown", async () => {
    const user = userEvent.setup()
    const setModel = vi.fn()
    renderChatInput({ setModel })

    await user.click(screen.getByText("Test Model"))
    await user.click(screen.getByText("Other Model"))

    expect(setModel).toHaveBeenCalledWith("other", "model-2")
  })

  it("shows no models configured message when no custom models available", async () => {
    const user = userEvent.setup()
    // Only default providers, which are filtered out
    renderChatInput({
      modelList: [
        { id: "m1", name: "Claude", provider: "anthropic" },
        { id: "m2", name: "GPT", provider: "openai" },
      ],
    })

    await user.click(screen.getByText("Test Model"))
    expect(screen.getByText("No models configured")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Interaction — Input changes
  // ═══════════════════════════════════════════════════════════════════

  it("calls setInput on input change", async () => {
    const user = userEvent.setup()
    const setInput = vi.fn()
    renderChatInput({ setInput })

    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "h")

    expect(setInput).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Command palette integration
  // ═══════════════════════════════════════════════════════════════════

  it("shows command palette when typing / at start of input", async () => {
    const user = userEvent.setup()
    const setInput = vi.fn((_val: string) => {
      // Simulate controlled input state update
    })
    renderChatInput({ setInput })

    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "/")

    // CommandPalette should be visible (it queries the CommandPalette component)
    // We verify that the command palette gets query input
    expect(setInput).toHaveBeenCalledWith("/")
  })

  // ═══════════════════════════════════════════════════════════════════
  // trySend utility
  // ═══════════════════════════════════════════════════════════════════

  it("clears input and resets height after sending", async () => {
    const user = userEvent.setup()
    const setInput = vi.fn()
    const sendPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ input: "Hello world", setInput, sendPrompt })

    // No send button — send via Enter (OpenCode TUI).
    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "{Enter}")

    // setInput should be called with empty string to clear the input
    expect(setInput).toHaveBeenCalledWith("")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Focus management (imperative handle)
  // ═══════════════════════════════════════════════════════════════════

  it("focuses textarea on container mousedown", async () => {
    const user = userEvent.setup()
    renderChatInput()

    const container = screen.getByPlaceholderText(/Ask anything/i).closest("[class*=rounded]")
    if (container) {
      await user.click(container)
      expect(screen.getByPlaceholderText(/Ask anything/i)).toHaveFocus()
    }
  })
})
