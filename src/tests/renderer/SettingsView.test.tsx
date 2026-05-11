// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// ── Mock logger ────────────────────────────────────────────────────
vi.mock("@/renderer/src/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock project-store ────────────────────────────────────────────
const mockSetActiveView = vi.fn()
vi.mock("@/renderer/src/stores/project-store", () => ({
  useProjectStore: vi.fn(() => ({
    setActiveView: mockSetActiveView,
  })),
}))

// ── Mock useZoom ───────────────────────────────────────────────────
const mockZoomIn = vi.fn()
const mockZoomOut = vi.fn()
const mockResetZoom = vi.fn()
vi.mock("@/renderer/src/hooks/useZoom", () => ({
  useZoom: () => ({
    zoom: 1,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    resetZoom: mockResetZoom,
    minZoom: 0.5,
    maxZoom: 2,
  }),
}))

// ── Mock NotificationSettingsContent ───────────────────────────────
vi.mock("@/renderer/src/components/ui/NotificationSettingsContent", () => ({
  NotificationSettingsContent: () => <div data-testid="notification-settings-content" />
}))

// Import after mocks
import { SettingsView } from "@/renderer/src/components/settings/SettingsView"

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should render the Settings header", () => {
    render(<SettingsView />)
    expect(screen.getByText("Settings")).toBeTruthy()
  })

  it("should render the Notifications section heading", () => {
    render(<SettingsView />)
    expect(screen.getByText("Notifications")).toBeTruthy()
  })

  it("should render the NotificationSettingsContent component", () => {
    render(<SettingsView />)
    expect(screen.getByTestId("notification-settings-content")).toBeTruthy()
  })

  it("should render the Appearance section heading", () => {
    render(<SettingsView />)
    expect(screen.getByText("Appearance")).toBeTruthy()
  })

  it("should render the Zoom control with current percentage", () => {
    render(<SettingsView />)
    expect(screen.getByText("100%")).toBeTruthy()
  })

  it("should render zoom range description", () => {
    render(<SettingsView />)
    expect(screen.getByText(/50%.*200%/)).toBeTruthy()
  })

  it("should call zoomIn when + button is clicked", () => {
    render(<SettingsView />)
    const plusBtn = screen.getByTitle("Zoom in")
    fireEvent.click(plusBtn)
    expect(mockZoomIn).toHaveBeenCalledTimes(1)
  })

  it("should call zoomOut when - button is clicked", () => {
    render(<SettingsView />)
    const minusBtn = screen.getByTitle("Zoom out")
    fireEvent.click(minusBtn)
    expect(mockZoomOut).toHaveBeenCalledTimes(1)
  })

  it("should call resetZoom when percentage button is clicked", () => {
    render(<SettingsView />)
    const resetBtn = screen.getByTitle("Reset zoom")
    fireEvent.click(resetBtn)
    expect(mockResetZoom).toHaveBeenCalledTimes(1)
  })

  it("should call setActiveView with chat when back button is clicked", () => {
    render(<SettingsView />)
    const backBtn = screen.getByTitle("Back to chat")
    fireEvent.click(backBtn)
    expect(mockSetActiveView).toHaveBeenCalledWith("chat")
  })

  it("should render the About section", () => {
    render(<SettingsView />)
    expect(screen.getByText("About")).toBeTruthy()
  })

  it("should display application info in About section", () => {
    render(<SettingsView />)
    expect(screen.getByText("NekoCode")).toBeTruthy()
    expect(screen.getByText("0.2.x")).toBeTruthy()
    expect(screen.getByText("Pi SDK")).toBeTruthy()
  })
})
