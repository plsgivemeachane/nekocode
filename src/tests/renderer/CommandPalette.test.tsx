// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"
import { CommandPalette } from "@/renderer/src/components/chat/CommandPalette"
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

function makeAnchorRect(): DOMRect {
  return new DOMRect(100, 500, 400, 40)
}

// ── Tests ──────────────────────────────────────────────────────────

describe("CommandPalette", () => {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const commands: CommandInfo[] = [
    makeCommand({ name: "deploy", description: "Deploy the app", source: "extension" }),
    makeCommand({ name: "skill:search", description: "Search the web", source: "skill" }),
    makeCommand({ name: "commit", description: "Git commit", source: "prompt" }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Visibility
  // ═══════════════════════════════════════════════════════════════════

  it("renders nothing when visible is false", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={false}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.queryByText("Commands")).toBeNull()
  })

  it("renders nothing when anchorRect is null", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={null}
      />
    )
    expect(screen.queryByText("Commands")).toBeNull()
  })

  it("renders palette when visible and anchorRect provided", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText("Commands")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Command List
  // ═══════════════════════════════════════════════════════════════════

  it("renders all command names", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText("deploy")).toBeTruthy()
    expect(screen.getByText("skill:search")).toBeTruthy()
    expect(screen.getByText("commit")).toBeTruthy()
  })

  it("renders command descriptions", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText("Deploy the app")).toBeTruthy()
  })

  it("shows count of available commands", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText("3 available")).toBeTruthy()
  })

  it("shows Loading... when isLoading is true", () => {
    render(
      <CommandPalette
        commands={[]}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
        isLoading={true}
      />
    )
    expect(screen.getByText("Loading...")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Filtering (cmdk handles filtering internally)
  // ═══════════════════════════════════════════════════════════════════

  it("filters commands by name", async () => {
    render(
      <CommandPalette
        commands={commands}
        query="dep"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    // cmdk should filter to show only matching commands
    await waitFor(() => {
      expect(screen.getByText("deploy")).toBeTruthy()
    })
    expect(screen.queryByText("commit")).toBeNull()
  })

  it("shows no results message when filter matches nothing", async () => {
    render(
      <CommandPalette
        commands={commands}
        query="xyz"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    await waitFor(() => {
      expect(screen.getByText("No commands found")).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Selection
  // ═══════════════════════════════════════════════════════════════════

  it("calls onSelect when clicking a command", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    fireEvent.click(screen.getByText("deploy"))
    expect(onSelect).toHaveBeenCalledWith(commands[0])
  })

  // ═══════════════════════════════════════════════════════════════════
  // Recent Commands Section
  // ═══════════════════════════════════════════════════════════════════

  it("shows Recent section when recentCommandNames provided and no query", () => {
    const recentNames = new Set(["deploy"])
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
        recentCommandNames={recentNames}
      />
    )
    expect(screen.getByText("Recent")).toBeTruthy()
    expect(screen.getByText("All Commands")).toBeTruthy()
  })

  it("does not show Recent section when query is present", () => {
    const recentNames = new Set(["deploy"])
    render(
      <CommandPalette
        commands={commands}
        query="dep"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
        recentCommandNames={recentNames}
      />
    )
    expect(screen.queryByText("Recent")).toBeNull()
  })

  it("does not show Recent section when recentCommandNames is empty", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
        recentCommandNames={new Set()}
      />
    )
    expect(screen.queryByText("Recent")).toBeNull()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Source Badges
  // ═══════════════════════════════════════════════════════════════════

  it("renders source badge for commands with a source", () => {
    render(
      <CommandPalette
        commands={[makeCommand({ name: "deploy", source: "extension" })]}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText("extension")).toBeTruthy()
  })

  it("renders skill badge", () => {
    render(
      <CommandPalette
        commands={[makeCommand({ name: "search", source: "skill" })]}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText("skill")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Footer
  // ═══════════════════════════════════════════════════════════════════

  it("renders keyboard shortcut hints in footer", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    expect(screen.getByText(/navigate/)).toBeTruthy()
    expect(screen.getByText(/↵ select/)).toBeTruthy()
    expect(screen.getByText(/close/)).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // ARIA
  // ═══════════════════════════════════════════════════════════════════

  it("has role=listbox and aria-label", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    // The outer wrapper div has role=listbox and aria-label
    // cmdk also renders a list role internally, so we query by label
    const listbox = screen.getByRole("listbox", { name: "Slash commands" })
    expect(listbox).toBeTruthy()
  })

  it("renders command items that are clickable", () => {
    render(
      <CommandPalette
        commands={commands}
        query=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
        anchorRect={makeAnchorRect()}
      />
    )
    // cmdk renders items with data attributes, not role=option
    // Verify all 3 commands are rendered
    expect(screen.getByText("deploy")).toBeTruthy()
    expect(screen.getByText("skill:search")).toBeTruthy()
    expect(screen.getByText("commit")).toBeTruthy()
  })
})
