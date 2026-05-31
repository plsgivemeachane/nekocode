// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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
  // Command List
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

    await waitFor(() => {
      expect(screen.getByText("deploy")).toBeInTheDocument()
    })
    expect(screen.queryByText("commit")).not.toBeInTheDocument()
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

    await waitFor(() => {
      expect(screen.getByText("No commands found")).toBeInTheDocument()
    })
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

  // ═══════════════════════════════════════════════════════════════════
  // Dialog close behavior
  // ═══════════════════════════════════════════════════════════════════

  it("calls onClose when dialog is closed", async () => {
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

    // Close via Escape key (Radix Dialog handles this)
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()
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
    // When all commands are in "other" and none in "recent", no Recent section appears
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
})
