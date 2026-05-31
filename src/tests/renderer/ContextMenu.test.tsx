// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/renderer/src/components/ui/context-menu"

// ── Tests ──────────────────────────────────────────────────────────

describe("ContextMenu (shadcn)", () => {
  it("renders trigger element", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item 1</ContextMenuItem>
          <ContextMenuItem>Item 2</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
    expect(screen.getByText("Right-click me")).toBeInTheDocument()
  })

  it("renders menu items after right-click", async () => {
    const user = userEvent.setup()
    render(
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item 1</ContextMenuItem>
          <ContextMenuItem>Item 2</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    // Right-click to open
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Target") })

    // Menu items should be visible after opening
    expect(screen.getByText("Item 1")).toBeInTheDocument()
    expect(screen.getByText("Item 2")).toBeInTheDocument()
  })

  it("calls on_select when item is clicked", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Click me</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Target") })
    await user.click(screen.getByText("Click me"))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it("renders separator between items", async () => {
    const user = userEvent.setup()
    render(
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item 1</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem>Item 2</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Target") })

    // Separator should be in the document as a Radix separator
    // Radix uses data-radix-context-menu-separator attribute
    const separator = document.querySelector('[data-radix-context-menu-separator]')
      ?? document.querySelector('[data-slot="context-menu-separator"]')
      ?? document.querySelector('[role="separator"]')
    expect(separator).toBeInTheDocument()
  })
})
