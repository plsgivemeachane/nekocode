// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"

// ── Hoisted mock functions (safe for vi.mock factories) ────────────
const { mockUpdateSettings, mockPlayPreview } = vi.hoisted(() => ({
  mockUpdateSettings: vi.fn(),
  mockPlayPreview: vi.fn(),
}))

const defaultSettings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 0.5,
  useCustomSounds: false,
  tasks: {
    aiResponseComplete: true,
    fileOperationComplete: true,
    extensionOperationComplete: true,
  },
}

const mockGetSettings = vi.fn()
const mockUpdateSettingsIpc = vi.fn()

// ── Mock logger ────────────────────────────────────────────────────
vi.mock("@/renderer/src/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock sound-manager ────────────────────────────────────────────
vi.mock("@/renderer/src/utils/sound-manager", () => ({
  soundManager: {
    updateSettings: mockUpdateSettings,
    playPreview: mockPlayPreview,
  },
}))

beforeEach(() => {
  mockGetSettings.mockResolvedValue(defaultSettings)
  mockUpdateSettingsIpc.mockResolvedValue(undefined)
  window.nekocode = {
    notification: {
      getSettings: mockGetSettings,
      updateSettings: mockUpdateSettingsIpc,
      onPlaySound: vi.fn(),
    },
  }
})

afterEach(() => {
  vi.clearAllMocks()
  delete (window as unknown as Record<string, unknown>).nekocode
})

// Import after mocks
import { NotificationSettingsContent } from "@/renderer/src/components/ui/NotificationSettingsContent"

describe("NotificationSettingsContent", () => {
  it("should show loading spinner while settings are loading", () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}))
    const { container } = render(<NotificationSettingsContent />)
    expect(container.querySelector("svg.animate-spin")).toBeTruthy()
  })

  it("should show error state when settings fail to load", async () => {
    mockGetSettings.mockRejectedValue(new Error("fail"))
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Failed to load settings.")).toBeTruthy()
    })
  })

  it("should render all settings when loaded", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Enable Notifications")).toBeTruthy()
    })
    expect(screen.getByText("Sound Effects")).toBeTruthy()
    expect(screen.getByText("Volume")).toBeTruthy()
    expect(screen.getByText("Preview Sounds")).toBeTruthy()
    expect(screen.getByText("Notify On")).toBeTruthy()
  })

  it("should display volume percentage", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("50%")).toBeTruthy()
    })
  })

  it("should render all sound preview buttons", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Task Complete")).toBeTruthy()
    })
    expect(screen.getByText("Success")).toBeTruthy()
    expect(screen.getByText("Error")).toBeTruthy()
    expect(screen.getByText("Warning")).toBeTruthy()
  })

  it("should render all per-task toggles", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("AI response complete")).toBeTruthy()
    })
    expect(screen.getByText("File operations complete")).toBeTruthy()
    expect(screen.getByText("Extension operations complete")).toBeTruthy()
  })

  it("should toggle master enable and call IPC + soundManager", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Enable Notifications")).toBeTruthy()
    })

    // First switch is the master enable (no aria-label in the component)
    const toggle = screen.getAllByRole("switch")[0]
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(mockUpdateSettingsIpc).toHaveBeenCalledWith({ enabled: false })
    })
    expect(mockUpdateSettings).toHaveBeenCalled()
  })

  it("should toggle sound enable and call IPC + soundManager", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Sound Effects")).toBeTruthy()
    })

    // Second switch is the sound effects toggle (no aria-label in the component)
    const toggle = screen.getAllByRole("switch")[1]
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(mockUpdateSettingsIpc).toHaveBeenCalledWith({ soundEnabled: false })
    })
    expect(mockUpdateSettings).toHaveBeenCalled()
  })

  it("should disable sound toggle when notifications are disabled", async () => {
    mockGetSettings.mockResolvedValue({ ...defaultSettings, enabled: false })
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Sound Effects")).toBeTruthy()
    })

    // Second switch is the sound effects toggle
    const toggle = screen.getAllByRole("switch")[1]
    expect(toggle.disabled).toBe(true)
  })

  it("should disable per-task toggles when notifications are disabled", async () => {
    mockGetSettings.mockResolvedValue({ ...defaultSettings, enabled: false })
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("AI response complete")).toBeTruthy()
    })

    // First two switches are master enable + sound effects; the rest are per-task
    const allSwitches = screen.getAllByRole("switch")
    const taskSwitches = allSwitches.slice(2)
    taskSwitches.forEach((toggle) => {
      expect(toggle.disabled).toBe(true)
    })
  })

  it("should call playPreview when preview button is clicked", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByTitle("Preview Task Complete")).toBeTruthy()
    })

    fireEvent.click(screen.getByTitle("Preview Task Complete"))
    expect(mockPlayPreview).toHaveBeenCalledWith("task-complete")
  })

  it("should update volume on slider change and commit on mouse up", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("Volume")).toBeTruthy()
    })

    const slider = screen.getByRole("slider") as HTMLInputElement
    fireEvent.change(slider, { target: { value: "75" } })

    expect(mockUpdateSettings).toHaveBeenCalled()

    fireEvent.mouseUp(slider)
    await waitFor(() => {
      expect(mockUpdateSettingsIpc).toHaveBeenCalledWith({ soundVolume: 0.75 })
    })
  })

  it("should toggle per-task setting and call IPC", async () => {
    render(<NotificationSettingsContent />)
    await waitFor(() => {
      expect(screen.getByText("AI response complete")).toBeTruthy()
    })

    // Find the toggle associated with the AI response task
    const taskLabel = screen.getByText("AI response complete").closest("label")!
    const toggle = taskLabel.querySelector('[role="switch"]') as HTMLElement
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(mockUpdateSettingsIpc).toHaveBeenCalledWith({
        tasks: { ...defaultSettings.tasks, aiResponseComplete: false },
      })
    })
  })
})
