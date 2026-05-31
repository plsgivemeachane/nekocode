// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { NavBar } from "@/renderer/src/components/layout/NavBar"
import { TooltipProvider } from "@/renderer/src/components/ui/tooltip"
import { createMockIPC, setupMockIPC, clearMockIPC } from "../__utils__/test-utils"

// ── Mock hooks ─────────────────────────────────────────────────────

const mockUseZoom = {
  zoom: 1,
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  resetZoom: vi.fn(),
  minZoom: 0.5,
  maxZoom: 2,
}

vi.mock("@/renderer/src/hooks/useZoom", () => ({
  useZoom: () => mockUseZoom,
}))

const mockAddProject = vi.fn(() => Promise.resolve())

vi.mock("@/renderer/src/stores/project-store", () => ({
  useProjectStore: () => ({ addProject: mockAddProject }),
}))

// ── Tests ──────────────────────────────────────────────────────────

describe("NavBar", () => {
  let mockIPC: ReturnType<typeof createMockIPC>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIPC = createMockIPC()
    setupMockIPC(mockIPC)
    Object.assign(mockUseZoom, {
      zoom: 1,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetZoom: vi.fn(),
      minZoom: 0.5,
      maxZoom: 2,
    })
  })

  afterEach(() => {
    clearMockIPC()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders the NekoCode logo", () => {
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByText("Neko")).toBeInTheDocument()
    expect(screen.getByText("code")).toBeInTheDocument()
  })

  it("renders the Add Project button", () => {
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByTitle("Add Project")).toBeInTheDocument()
  })

  it("renders zoom controls with percentage", () => {
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByTitle("Zoom out (Ctrl+-)")).toBeInTheDocument()
    expect(screen.getByText("100%")).toBeInTheDocument()
    expect(screen.getByTitle("Zoom in (Ctrl+=)")).toBeInTheDocument()
    expect(screen.getByTitle("Reset zoom (Ctrl+0)")).toBeInTheDocument()
  })

  it("renders window control buttons", () => {
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /maximize/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument()
  })

  it("updates zoom percentage display when zoom changes", () => {
    mockUseZoom.zoom = 1.5
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByText("150%")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Zoom interactions
  // ═══════════════════════════════════════════════════════════════════

  it("calls zoomIn when + button is clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    await user.click(screen.getByTitle("Zoom in (Ctrl+=)"))
    expect(mockUseZoom.zoomIn).toHaveBeenCalled()
  })

  it("calls zoomOut when - button is clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    await user.click(screen.getByTitle("Zoom out (Ctrl+-)"))
    expect(mockUseZoom.zoomOut).toHaveBeenCalled()
  })

  it("calls resetZoom when percentage button is clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    await user.click(screen.getByTitle("Reset zoom (Ctrl+0)"))
    expect(mockUseZoom.resetZoom).toHaveBeenCalled()
  })

  it("disables zoom out at minimum zoom", () => {
    mockUseZoom.zoom = 0.5
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByTitle("Zoom out (Ctrl+-)")).toBeDisabled()
  })

  it("disables zoom in at maximum zoom", () => {
    mockUseZoom.zoom = 2
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByTitle("Zoom in (Ctrl+=)")).toBeDisabled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Window control interactions
  // ═══════════════════════════════════════════════════════════════════

  it("calls window.minimize when minimize button is clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    await user.click(screen.getByRole("button", { name: /minimize/i }))
    expect(mockIPC.window.minimize).toHaveBeenCalled()
  })

  it("calls window.maximize when maximize button is clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    await user.click(screen.getByRole("button", { name: /maximize/i }))
    expect(mockIPC.window.maximize).toHaveBeenCalled()
  })

  it("calls window.close when close button is clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    await user.click(screen.getByRole("button", { name: /close/i }))
    expect(mockIPC.window.close).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Add project interaction
  // ═══════════════════════════════════════════════════════════════════

  it("opens folder dialog and adds project when folder is selected", async () => {
    const user = userEvent.setup()
    ;(mockIPC.dialog.openFolder as ReturnType<typeof vi.fn>).mockResolvedValue("/test/new-project")
    render(<TooltipProvider><NavBar /></TooltipProvider>)

    await user.click(screen.getByTitle("Add Project"))

    expect(mockIPC.dialog.openFolder).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockAddProject).toHaveBeenCalledWith("/test/new-project")
  })

  it("does not add project when folder dialog is cancelled", async () => {
    const user = userEvent.setup()
    ;(mockIPC.dialog.openFolder as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(<TooltipProvider><NavBar /></TooltipProvider>)

    await user.click(screen.getByTitle("Add Project"))

    expect(mockIPC.dialog.openFolder).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockAddProject).not.toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Maximize/restore state
  // ═══════════════════════════════════════════════════════════════════

  it("shows Restore label when window is maximized", async () => {
    (mockIPC.window.isMaximized as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    render(<TooltipProvider><NavBar /></TooltipProvider>)

    // Wait for the async isMaximized call to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByRole("button", { name: /restore/i })).toBeInTheDocument()
  })
})
