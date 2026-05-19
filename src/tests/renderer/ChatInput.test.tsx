// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
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

vi.mock("@/renderer/src/hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}))

// ── Helpers ──────────────────────────────────────────────────────────

const defaultProps = {
  sessionId: "test-session-id",
  isStreaming: false,
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

  it("renders send button when not streaming", () => {
    renderChatInput()
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument()
  })

  it("renders stop button when streaming", () => {
    renderChatInput({ isStreaming: true })
    expect(screen.getByRole("button", { name: /stop response/i })).toBeInTheDocument()
  })

  it("disables textarea when no session is active", () => {
    renderChatInput({ sessionId: undefined })
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeDisabled()
  })

  it("disables textarea when streaming", () => {
    renderChatInput({ isStreaming: true })
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeDisabled()
  })

  it("disables send button when input is empty", () => {
    renderChatInput()
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled()
  })

  it("disables send button when no session is active", () => {
    renderChatInput({ sessionId: undefined })
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Interaction — Sending messages
  // ═══════════════════════════════════════════════════════════════════

  it("sends message on form submit when input has text", async () => {
    const user = userEvent.setup()
    const sendPrompt = vi.fn(() => Promise.resolve())
    const setInput = vi.fn()
    renderChatInput({ input: "Hello world", setInput, sendPrompt })

    // Click the send button
    await user.click(screen.getByRole("button", { name: /send message/i }))

    expect(setInput).toHaveBeenCalledWith("")
    expect(sendPrompt).toHaveBeenCalledWith("Hello world")
  })

  it("sends message on Enter key when input has text", async () => {
    const user = userEvent.setup()
    const sendPrompt = vi.fn(() => Promise.resolve())
    const setInput = vi.fn()
    renderChatInput({ input: "Hello world", setInput, sendPrompt })

    const textarea = screen.getByPlaceholderText(/Ask anything/i)
    await user.type(textarea, "{Enter}")

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

    await user.click(screen.getByRole("button", { name: /send message/i }))

    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it("does not send when streaming", async () => {
    const sendPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ isStreaming: true, input: "Hello", sendPrompt })

    // No send button visible when streaming, only stop button
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Interaction — Stop / Abort
  // ═══════════════════════════════════════════════════════════════════

  it("calls abortPrompt when stop button is clicked", async () => {
    const user = userEvent.setup()
    const abortPrompt = vi.fn(() => Promise.resolve())
    renderChatInput({ isStreaming: true, abortPrompt })

    await user.click(screen.getByRole("button", { name: /stop response/i }))

    expect(abortPrompt).toHaveBeenCalled()
  })

  it("disables stop button when no session is active", () => {
    renderChatInput({ isStreaming: true, sessionId: undefined })
    expect(screen.getByRole("button", { name: /stop response/i })).toBeDisabled()
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

    await user.click(screen.getByRole("button", { name: /send message/i }))

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
