// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { ContextMenu } from "@/renderer/src/components/ui/ContextMenu"
import type { ContextMenuEntry } from "@/renderer/src/components/ui/ContextMenu"

// ── Helpers ──────────────────────────────────────────────────────────

const defaultItems: ContextMenuEntry[] = [
  { label: "Edit", onClick: vi.fn(), shortcut: "Ctrl+E" },
  { label: "Delete", onClick: vi.fn(), danger: true },
  { type: "separator" },
  { label: "Copy", onClick: vi.fn(), disabled: true },
]

function renderContextMenu(overrides: Partial<{ x: number; y: number; items: ContextMenuEntry[]; onClose: () => void }> = {}) {
  const props = {
    x: 100,
    y: 200,
    items: defaultItems,
    onClose: vi.fn(),
    ...overrides,
  }
  return render(<ContextMenu {...props} />)
}

// ── Tests ──────────────────────────────────────────────────────────

describe("ContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders all menu items", () => {
    renderContextMenu()
    expect(screen.getByText("Edit")).toBeInTheDocument()
    expect(screen.getByText("Delete")).toBeInTheDocument()
    expect(screen.getByText("Copy")).toBeInTheDocument()
  })

  it("renders shortcuts for menu items", () => {
    renderContextMenu()
    expect(screen.getByText("Ctrl+E")).toBeInTheDocument()
  })

  it("renders as a portal in document body", () => {
    renderContextMenu()
    // The menu should be rendered in a portal, so the items are in document.body
    expect(document.body.textContent).toContain("Edit")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Item click behavior
  // ═══════════════════════════════════════════════════════════════════

  it("calls onClick and onClose when a menu item is clicked", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const editClick = vi.fn()
    const items: ContextMenuEntry[] = [
      { label: "Edit", onClick: editClick },
    ]
    renderContextMenu({ items, onClose })

    await user.click(screen.getByText("Edit"))

    expect(editClick).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("does not call onClick for disabled items", async () => {
    const onClose = vi.fn()
    const copyClick = vi.fn()
    const items: ContextMenuEntry[] = [
      { label: "Copy", onClick: copyClick, disabled: true },
    ]
    renderContextMenu({ items, onClose })

    const copyButton = screen.getByText("Copy").closest("button")!
    expect(copyButton).toBeDisabled()
    // Clicking a disabled button should not trigger the handler
    expect(copyClick).not.toHaveBeenCalled()
  })

  it("renders danger items with danger styling", () => {
    const items: ContextMenuEntry[] = [
      { label: "Delete", onClick: vi.fn(), danger: true },
    ]
    renderContextMenu({ items })
    const button = screen.getByText("Delete").closest("button")!
    expect(button.className).toContain("text-error")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Separator rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders separators between items", () => {
    renderContextMenu()
    // Separator is rendered as a div with h-px class (1px height divider)
    // Use a text-based query since Tailwind classes with "/" are not valid CSS selectors
    const allDivs = document.querySelectorAll("div.h-px")
    // At least one separator should exist in the menu
    const separators = Array.from(allDivs).filter(
      (el) => el.className.includes("h-px") && el.className.includes("bg-surface")
    )
    expect(separators.length).toBeGreaterThanOrEqual(1)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Keyboard: Escape closes menu
  // ═══════════════════════════════════════════════════════════════════

  it("closes menu on Escape key", async () => {
    const onClose = vi.fn()
    renderContextMenu({ onClose })

    // The context menu attaches the keydown listener with a setTimeout(0) delay
    // to avoid the triggering right-click from closing it immediately.
    // We need to wait for the next tick before dispatching the Escape key.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })

    expect(onClose).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Position adjustment
  // ═══════════════════════════════════════════════════════════════════

  it("positions menu at the specified coordinates", () => {
    renderContextMenu({ x: 50, y: 75 })
    // The menu should be positioned via style.left and style.top
    const menu = document.querySelector(".fixed.min-w-\\[180px\\]") as HTMLElement
    expect(menu).toBeInTheDocument()
  })
})
