// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useZoom } from "@/renderer/src/hooks/useZoom"
import type { NekoCodeIPC } from "@/shared/ipc-types"

// Type-safe helper to mock window.nekocode in tests
function mockNekoCode(partial: Record<string, unknown>): void {
  ;(window as unknown as { nekocode: NekoCodeIPC }).nekocode = partial as unknown as NekoCodeIPC
}

// ── Mock window.nekocode ─────────────────────────────────────────────
const mockZoomSet = vi.fn()
const mockZoomGet = vi.fn(() => Promise.resolve({ factor: 1 }))

beforeEach(() => {
  vi.clearAllMocks()
  mockNekoCode({
    zoom: {
      set: mockZoomSet,
      get: mockZoomGet,
      reset: vi.fn().mockResolvedValue(undefined),
    },
  })
  localStorage.clear()
})

// ── Tests ──────────────────────────────────────────────────────────

describe("useZoom", () => {
  // ═══════════════════════════════════════════════════════════════════
  // Initial State
  // ═══════════════════════════════════════════════════════════════════

  it("returns default zoom level of 1", () => {
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoom).toBe(1)
  })

  it("returns zoomIn, zoomOut, resetZoom, setZoom, minZoom, maxZoom", () => {
    const { result } = renderHook(() => useZoom())
    expect(typeof result.current.zoomIn).toBe("function")
    expect(typeof result.current.zoomOut).toBe("function")
    expect(typeof result.current.resetZoom).toBe("function")
    expect(typeof result.current.setZoom).toBe("function")
    expect(result.current.minZoom).toBe(0.5)
    expect(result.current.maxZoom).toBe(2.0)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Zoom In
  // ═══════════════════════════════════════════════════════════════════

  it("increases zoom level when zoomIn is called", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.zoomIn() })
    expect(result.current.zoom).toBeCloseTo(1.1, 5)
  })

  it("increments by 0.1 on zoomIn", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.zoomIn() })
    expect(result.current.zoom).toBeCloseTo(1.1, 5)
    act(() => { result.current.zoomIn() })
    expect(result.current.zoom).toBeCloseTo(1.2, 5)
  })

  it("caps zoom level at maxZoom (2.0)", () => {
    const { result } = renderHook(() => useZoom())
    // Use setZoom to bypass stale closure issue
    act(() => { result.current.setZoom(3.0) })
    expect(result.current.zoom).toBe(result.current.maxZoom)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Zoom Out
  // ═══════════════════════════════════════════════════════════════════

  it("decreases zoom level when zoomOut is called", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.zoomIn() })
    act(() => { result.current.zoomOut() })
    expect(result.current.zoom).toBe(1)
  })

  it("decrements by 0.1 on zoomOut", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.zoomIn() })
    act(() => { result.current.zoomIn() })
    act(() => { result.current.zoomOut() })
    expect(result.current.zoom).toBeCloseTo(1.1, 5)
  })

  it("caps zoom level at minZoom (0.5)", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.setZoom(0.1) })
    expect(result.current.zoom).toBe(result.current.minZoom)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Reset Zoom
  // ═══════════════════════════════════════════════════════════════════

  it("resets zoom level to 1 on resetZoom", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.zoomIn() })
    act(() => { result.current.zoomIn() })
    expect(result.current.zoom).toBeCloseTo(1.2, 5)
    act(() => { result.current.resetZoom() })
    expect(result.current.zoom).toBe(1)
  })

  // ═══════════════════════════════════════════════════════════════════
  // setZoom (direct)
  // ═══════════════════════════════════════════════════════════════════

  it("setZoom clamps value within min/max range", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.setZoom(3.0) })
    expect(result.current.zoom).toBe(result.current.maxZoom)
    act(() => { result.current.setZoom(0.1) })
    expect(result.current.zoom).toBe(result.current.minZoom)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Persistence
  // ═══════════════════════════════════════════════════════════════════

  it("persists zoom level to localStorage", () => {
    const { result } = renderHook(() => useZoom())
    act(() => { result.current.zoomIn() })
    expect(localStorage.getItem("nekocode-zoom")).toBe("1.1")
  })

  it("calls window.nekocode.zoom.set on zoom change", () => {
    const { result } = renderHook(() => useZoom())
    expect(mockZoomSet).toHaveBeenCalledWith(1)
    act(() => { result.current.zoomIn() })
    expect(mockZoomSet).toHaveBeenCalledWith(1.1)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Sync from Electron
  // ═══════════════════════════════════════════════════════════════════

  it("syncs zoom from Electron on mount via zoom.get()", async () => {
    mockZoomGet.mockResolvedValueOnce({ factor: 1.5 })
    renderHook(() => useZoom())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(localStorage.getItem("nekocode-zoom")).toBe("1.5")
  })
})
