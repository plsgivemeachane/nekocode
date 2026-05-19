// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { GlobalCommandPalette } from "@/renderer/src/components/chat/GlobalCommandPalette"
import type { CommandInfo } from "@/shared/ipc-types"

// ── Helpers ──────────────────────────────────────────────────────────

function makeCommand(overrides: Partial<CommandInfo> = {}): CommandInfo {
  return {
    name: "test-command",
    description: "A test command",
    source: "extension",
    ...overrides,
  }
}

const defaultCommands: CommandInfo[] = [
  makeCommand({ name: "deploy", description: "Deploy the app", source: "extension" }),
  makeCommand({ name: "skill:search", description: "Search the web", source: "skill" }),
  makeCommand({ name: "commit", description: "Git commit", source: "prompt" }),
  makeCommand({ name: "help", description: "Show help", source: "workflow" }),
]

// ── Tests ──────────────────────────────────────────────────────────

describe("GlobalCommandPalette", () => {
  const onSelect = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Visibility
  // ═══════════════════════════════════════════════════════════════════

  it("renders nothing when visible is false", () => {
    render(
      <GlobalCommandPalette
        visible={false}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.queryByPlaceholderText(/search commands/i)).not.toBeInTheDocument()
  })

  it("renders the palette when visible is true", () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.getByPlaceholderText(/search commands/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Search input
  // ═══════════════════════════════════════════════════════════════════

  it("shows all commands when no search query is entered", () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.getByText("deploy")).toBeInTheDocument()
    expect(screen.getByText("skill:search")).toBeInTheDocument()
    expect(screen.getByText("commit")).toBeInTheDocument()
    expect(screen.getByText("help")).toBeInTheDocument()
  })

  it("filters commands by name when typing in search input", async () => {
    const user = userEvent.setup()
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    const input = screen.getByPlaceholderText(/search commands/i)
    await user.type(input, "dep")

    expect(screen.getByText("deploy")).toBeInTheDocument()
    expect(screen.queryByText("commit")).not.toBeInTheDocument()
  })

  it("filters commands by description when typing in search input", async () => {
    const user = userEvent.setup()
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    const input = screen.getByPlaceholderText(/search commands/i)
    await user.type(input, "git")

    expect(screen.getByText("commit")).toBeInTheDocument()
    expect(screen.queryByText("deploy")).not.toBeInTheDocument()
  })

  it("shows no commands found when search has no matches", async () => {
    const user = userEvent.setup()
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    const input = screen.getByPlaceholderText(/search commands/i)
    await user.type(input, "xyz")

    expect(screen.getByText("No commands found")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Loading state
  // ═══════════════════════════════════════════════════════════════════

  it("shows loading indicator when isLoading is true", () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={[]}
        isLoading={true}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/loading commands/i)).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Command selection
  // ═══════════════════════════════════════════════════════════════════

  it("calls onSelect when a command is clicked", async () => {
    const user = userEvent.setup()
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    await user.click(screen.getByText("deploy"))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deploy" })
    )
  })

  it("calls onSelect when Enter is pressed on highlighted command", async () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    })

    // First command should be selected by default
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deploy" })
    )
  })

  // ═══════════════════════════════════════════════════════════════════
  // Keyboard navigation
  // ═══════════════════════════════════════════════════════════════════

  it("navigates down with ArrowDown key", async () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    // Navigate down once then press Enter
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    })

    // Second command should be selected
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "skill:search" })
    )
  })

  it("navigates up with ArrowUp key", async () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    // Navigate down twice, then up once, then Enter
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "skill:search" })
    )
  })

  it("calls onClose when Escape is pressed", async () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    })

    expect(onClose).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Backdrop click
  // ═══════════════════════════════════════════════════════════════════

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup()
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    // The backdrop has the click handler
    const backdrop = document.querySelector('.fixed.inset-0.z-\\[9999\\] > .absolute.inset-0')
    if (backdrop) {
      await user.click(backdrop)
      expect(onClose).toHaveBeenCalled()
    }
  })

  // ═══════════════════════════════════════════════════════════════════
  // Recent commands section
  // ═══════════════════════════════════════════════════════════════════

  it("shows recent section when recentCommandNames is provided and has matching commands", () => {
    const recentNames = new Set(["deploy", "commit"])
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
        recentCommandNames={recentNames}
      />
    )
    expect(screen.getByText("Recent")).toBeInTheDocument()
    expect(screen.getByText("All Commands")).toBeInTheDocument()
  })

  it("does not show recent section when no recentCommandNames match", () => {
    const recentNames = new Set(["nonexistent"])
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
        recentCommandNames={recentNames}
      />
    )
    expect(screen.queryByText("Recent")).not.toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Source badges
  // ═══════════════════════════════════════════════════════════════════

  it("displays source badges for commands", () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.getByText("extension")).toBeInTheDocument()
    expect(screen.getByText("skill")).toBeInTheDocument()
    expect(screen.getByText("prompt")).toBeInTheDocument()
    expect(screen.getByText("workflow")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Footer
  // ═══════════════════════════════════════════════════════════════════

  it("shows command count in footer", () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={defaultCommands}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/4 commands/i)).toBeInTheDocument()
  })

  it("shows singular command count for single command", () => {
    render(
      <GlobalCommandPalette
        visible={true}
        commands={[defaultCommands[0]]}
        isLoading={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/1 command$/i)).toBeInTheDocument()
  })
})
