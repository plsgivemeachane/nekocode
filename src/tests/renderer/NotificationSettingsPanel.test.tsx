// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// ── Hoisted mock for useClickOutside ──────────────────────────────
const { mockUseClickOutside } = vi.hoisted(() => ({
  mockUseClickOutside: vi.fn(),
}))

// ── Mock useClickOutside ───────────────────────────────────────────
vi.mock("@/renderer/src/hooks/useClickOutside", () => ({
  useClickOutside: mockUseClickOutside,
}))

// ── Mock NotificationSettingsContent ───────────────────────────────
vi.mock("@/renderer/src/components/ui/NotificationSettingsContent", () => ({
  NotificationSettingsContent: () => <div data-testid="notification-settings-content" />
}))

// Import after mocks
import { NotificationSettingsPanel } from "@/renderer/src/components/ui/NotificationSettingsPanel"

describe("NotificationSettingsPanel", () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should render nothing when isOpen is false", () => {
    const { container } = render(<NotificationSettingsPanel isOpen={false} onClose={mockOnClose} />)
    expect(container.innerHTML).toBe("")
  })

  it("should render the dialog when isOpen is true", () => {
    render(<NotificationSettingsPanel isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByText("Notification Settings")).toBeTruthy()
  })

  it("should render NotificationSettingsContent inside the dialog", () => {
    render(<NotificationSettingsPanel isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByTestId("notification-settings-content")).toBeTruthy()
  })

  it("should call onClose when close button is clicked", () => {
    render(<NotificationSettingsPanel isOpen={true} onClose={mockOnClose} />)
    fireEvent.click(screen.getByLabelText("Close"))
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it("should have dialog role and aria-label", () => {
    render(<NotificationSettingsPanel isOpen={true} onClose={mockOnClose} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("aria-label")).toBe("Notification Settings")
  })

  it("should pass ref and isOpen/onClose to useClickOutside", () => {
    render(<NotificationSettingsPanel isOpen={true} onClose={mockOnClose} />)
    expect(mockUseClickOutside).toHaveBeenCalled()
    const args = mockUseClickOutside.mock.calls[0]
    expect(args[1]).toBe(true)
    expect(args[2]).toBe(mockOnClose)
  })

  it("should render the backdrop overlay", () => {
    render(<NotificationSettingsPanel isOpen={true} onClose={mockOnClose} />)
    const backdrop = screen.getByRole("dialog").parentElement!
    expect(backdrop.className).toContain("bg-black/40")
  })
})
