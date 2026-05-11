// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mock functions (declared before class that uses them) ──────────
const mockOscillatorStart = vi.fn()
const mockOscillatorStop = vi.fn()
const mockOscillatorConnect = vi.fn()
const mockGainConnect = vi.fn()
const mockGainSetValue = vi.fn()
const mockGainRamp = vi.fn()
const mockCtxClose = vi.fn()
const mockCtxResume = vi.fn()
const mockCreateOscillator = vi.fn(() => ({
  type: "sine",
  frequency: { setValueAtTime: vi.fn() },
  connect: mockOscillatorConnect,
  start: mockOscillatorStart,
  stop: mockOscillatorStop,
}))
const mockCreateGain = vi.fn(() => ({
  gain: {
    setValueAtTime: mockGainSetValue,
    exponentialRampToValueAtTime: mockGainRamp,
  },
  connect: mockGainConnect,
}))

// ── Mutable state for mock AudioContext ────────────────────────────
let mockCtxState: AudioContextState = "running"

// ── Mock AudioContext as a proper class ─────────────────────────────
class MockAudioContext {
  close = mockCtxClose
  resume = mockCtxResume
  createOscillator = mockCreateOscillator
  createGain = mockCreateGain
  destination = {}
  get state() { return mockCtxState }
  currentTime = 0
}

// Install the mock BEFORE any import that might reference AudioContext
globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext

// ── Default mock settings ──────────────────────────────────────────
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

// ── Mock logger ────────────────────────────────────────────────────
vi.mock("@/renderer/src/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Reset mock AudioContext state for each test
  mockCtxState = "running"
  // Set up window.nekocode before any init() call
  window.nekocode = {
    notification: {
      getSettings: vi.fn().mockResolvedValue(defaultSettings),
      onPlaySound: vi.fn(() => vi.fn()),
    },
  } as unknown as typeof window.nekocode
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>).nekocode
})

// Import after mocks — singleton instance created at module level
import { soundManager } from "@/renderer/src/utils/sound-manager"

describe("SoundManager", () => {
  describe("init", () => {
    it("should create an AudioContext on init", async () => {
      await soundManager.init()
      // Verify the mock was used — check by calling dispose which calls ctx.close
      soundManager.dispose()
      expect(mockCtxClose).toHaveBeenCalled()
    })

    it("should be idempotent — only create AudioContext once", async () => {
      await soundManager.init()
      const ctorSpy = vi.spyOn(globalThis, "AudioContext" as never) as ReturnType<typeof vi.spyOn>
      await soundManager.init()
      expect(ctorSpy).not.toHaveBeenCalled()
      ctorSpy.mockRestore()
      soundManager.dispose()
    })

    it("should load settings from IPC on init", async () => {
      await soundManager.init()
      expect((window.nekocode as unknown as { notification: { getSettings: ReturnType<typeof vi.fn> } }).notification.getSettings).toHaveBeenCalled()
      soundManager.dispose()
    })

    it("should register IPC listener for onPlaySound", async () => {
      await soundManager.init()
      expect((window.nekocode as unknown as { notification: { onPlaySound: ReturnType<typeof vi.fn> } }).notification.onPlaySound).toHaveBeenCalled()
      soundManager.dispose()
    })

    it("should not throw when IPC getSettings fails", async () => {
      ;(window.nekocode as unknown as { notification: { getSettings: ReturnType<typeof vi.fn> } }).notification.getSettings.mockRejectedValue(new Error("fail"))
      await expect(soundManager.init()).resolves.not.toThrow()
      soundManager.dispose()
    })
  })

  describe("dispose", () => {
    it("should close AudioContext and clean up IPC listener", async () => {
      await soundManager.init()
      soundManager.dispose()
      expect(mockCtxClose).toHaveBeenCalled()
    })

    it("should allow re-init after dispose", async () => {
      await soundManager.init()
      soundManager.dispose()
      vi.clearAllMocks()
      await soundManager.init()
      soundManager.dispose()
      expect(mockCtxClose).toHaveBeenCalled()
    })
  })

  describe("updateSettings", () => {
    it("should update internal settings without error", async () => {
      await soundManager.init()
      const newSettings = {
        enabled: true,
        soundEnabled: false,
        soundVolume: 0.3,
        useCustomSounds: false,
        tasks: {
          aiResponseComplete: false,
          fileOperationComplete: true,
          extensionOperationComplete: true,
        },
      }
      expect(() => soundManager.updateSettings(newSettings)).not.toThrow()
      soundManager.dispose()
    })
  })

  describe("playPreview", () => {
    it("should do nothing if AudioContext is not initialized", () => {
      soundManager.playPreview("task-complete")
      expect(mockOscillatorStart).not.toHaveBeenCalled()
    })

    it("should resume suspended AudioContext before playing", async () => {
      await soundManager.init()
      mockCtxState = "suspended"
      soundManager.playPreview("task-complete")
      expect(mockCtxResume).toHaveBeenCalled()
      soundManager.dispose()
    })

    it("should create oscillators for task-complete sound", async () => {
      await soundManager.init()
      mockCtxState = "running"
      soundManager.playPreview("task-complete")
      expect(mockCreateOscillator).toHaveBeenCalled()
      expect(mockOscillatorStart).toHaveBeenCalled()
      soundManager.dispose()
    })

    it("should create oscillator for success sound", async () => {
      await soundManager.init()
      mockCtxState = "running"
      soundManager.playPreview("success")
      expect(mockOscillatorStart).toHaveBeenCalled()
      soundManager.dispose()
    })

    it("should create oscillator for error sound", async () => {
      await soundManager.init()
      mockCtxState = "running"
      soundManager.playPreview("error")
      expect(mockOscillatorStart).toHaveBeenCalled()
      soundManager.dispose()
    })

    it("should create oscillator for warning sound", async () => {
      await soundManager.init()
      mockCtxState = "running"
      soundManager.playPreview("warning")
      expect(mockOscillatorStart).toHaveBeenCalled()
      soundManager.dispose()
    })
  })
})
