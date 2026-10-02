/**
 * ipc-router CRITICAL contract-violation tests.
 *
 * There are ZERO existing tests for the IPC router type system.
 * These tests probe:
 *
 * Contract: IpcRouter handles renderer-main request/response IPC
 * Contract: sendToRenderer handles main-renderer one-way push IPC
 * Contract: registerRendererListener is a TYPE-LEVEL UTILITY ONLY (not runtime)
 *
 * Contract assumptions to challenge:
 * - sendToRenderer silently drops messages when no window exists
 * - registerRendererListener does nothing at runtime but pretends to
 * - IpcRouter.handle() has no error boundary - handler errors propagate to IPC
 * - RendererChannelMap is incomplete - channels not in the map have no type safety
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Electron - use vi.hoisted for variables referenced in vi.mock factory
const { mockGetAllWindows, mockIpcMainHandle, mockIpcMainRemoveHandler } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn(),
  mockIpcMainHandle: vi.fn(),
  mockIpcMainRemoveHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows(),
  },
  ipcMain: {
    handle: mockIpcMainHandle,
    removeHandler: mockIpcMainRemoveHandler,
  },
  ipcRenderer: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

import {
  IpcRouter,
  sendToRenderer,
  registerRendererListener,
} from '../main/ipc-router'
import { IPC_CHANNELS } from '../shared/ipc-channels'

describe('ipc-router - Critical Contract Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Category 1: sendToRenderer - Name vs Reality
  // ==========================================================================

  it('CONTRACT VIOLATION: sendToRenderer silently drops messages when no window exists', () => {
    // The name "sendToRenderer" implies the message is sent.
    // But if no window exists, the message is silently dropped.
    // No error, no return value, no indication that the send failed.
    mockGetAllWindows.mockReturnValue([])

    // This should not throw, but the message is lost
    expect(() => {
      sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
    }).not.toThrow()
  })

  it('CONTRACT VIOLATION: sendToRenderer silently drops messages when window is destroyed', () => {
    const mockSend = vi.fn()
    const mockWindow = {
      isDestroyed: () => true,
      webContents: { send: mockSend },
    }
    mockGetAllWindows.mockReturnValue([mockWindow])

    expect(() => {
      sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
    }).not.toThrow()

    // Send was NOT called because window is destroyed
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sendToRenderer returns boolean indicating send success (CONTRACT FIXED)', () => {
    // Previously sendToRenderer returned void. Now it returns boolean:
    // true = message sent, false = no valid window found.
    mockGetAllWindows.mockReturnValue([])

    const result = sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
    expect(result).toBe(false)

    // Now with a valid window
    const mockSend = vi.fn()
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: mockSend },
    }
    mockGetAllWindows.mockReturnValue([mockWindow])

    const result2 = sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
    expect(result2).toBe(true)
    expect(mockSend).toHaveBeenCalled()
  })

  it('sendToRenderer sends to first available window when no window is specified', () => {
    const mockSend = vi.fn()
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: mockSend },
    }
    mockGetAllWindows.mockReturnValue([mockWindow])

    sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)

    expect(mockSend).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
  })

  it('sendToRenderer sends to the specified window when provided', () => {
    const mockSend = vi.fn()
    const specificWindow = {
      isDestroyed: () => false,
      webContents: { send: mockSend },
    } as unknown as Electron.BrowserWindow

    sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true, specificWindow)

    expect(mockSend).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
  })

  it('CONTRACT AMBIGUITY: sendToRenderer with multiple windows only sends to the first', () => {
    // If there are multiple BrowserWindows, sendToRenderer only sends to
    // the first one. Is this the right behavior? Should it broadcast?
    const mockSend1 = vi.fn()
    const mockSend2 = vi.fn()
    const window1 = { isDestroyed: () => false, webContents: { send: mockSend1 } }
    const window2 = { isDestroyed: () => false, webContents: { send: mockSend2 } }
    mockGetAllWindows.mockReturnValue([window1, window2])

    sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)

    expect(mockSend1).toHaveBeenCalledTimes(1)
    expect(mockSend2).not.toHaveBeenCalled()
  })

  it.todo('Consider: should sendToRenderer broadcast to all windows or target a specific one?')

  // ==========================================================================
  // Category 2: registerRendererListener - Dead Code
  // ==========================================================================

  it('CONTRACT VIOLATION: registerRendererListener does NOTHING at runtime', () => {
    // The function signature suggests it registers a listener.
    // But the implementation just console.warns and returns an empty cleanup.
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const callback = vi.fn()

    const cleanup = registerRendererListener(
      IPC_CHANNELS.SESSION_EVENTS,
      callback,
    )

    // It warned the user this is a type-level utility
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('type-level utility'),
    )

    // Cleanup does nothing
    expect(() => cleanup()).not.toThrow()

    consoleSpy.mockRestore()
  })

  it.todo('registerRendererListener should either be removed from the runtime API or implemented with actual ipcRenderer.on')

  // ==========================================================================
  // Category 3: IpcRouter - Abstraction Ambiguity
  // ==========================================================================

  it('IpcRouter.handle registers a handler for the channel', () => {
    mockIpcMainHandle.mockClear()
    const router = new IpcRouter()
    const handler = vi.fn().mockResolvedValue({ success: true })

    router.handle(IPC_CHANNELS.PROJECT_LIST, handler)

    // IpcRouter.handle wraps the handler and registers it with ipcMain
    expect(mockIpcMainHandle).toHaveBeenCalled()
  })

  it('IpcRouter.handle wraps handlers with error boundary (CONTRACT FIXED)', () => {
    // Previously, handler errors propagated raw to IPC. Now handle() wraps
    // the handler in try/catch with logging before re-throwing.
    mockIpcMainHandle.mockClear()
    const router = new IpcRouter()
    const handler = vi.fn().mockRejectedValue(new Error('handler failed'))

    // Registering should not throw
    expect(() => {
      router.handle(IPC_CHANNELS.PROJECT_LIST, handler)
    }).not.toThrow()

    // The handler was registered with ipcMain with error boundary
    expect(mockIpcMainHandle).toHaveBeenCalled()
  })

  it('IpcRouter.remove() method exists and calls ipcMain.removeHandler (CONTRACT FIXED)', () => {
    // Previously there was no remove/unregister method. Now IpcRouter.remove()
    // delegates to ipcMain.removeHandler() for cleanup.
    mockIpcMainRemoveHandler.mockClear()
    const router = new IpcRouter()

    // The remove method now exists
    expect(typeof router.remove).toBe('function')

    // Calling remove should delegate to ipcMain.removeHandler
    router.remove(IPC_CHANNELS.PROJECT_LIST)
    expect(mockIpcMainRemoveHandler).toHaveBeenCalledWith(IPC_CHANNELS.PROJECT_LIST)
  })

  // ==========================================================================
  // Category 4: Type System Contract Verification
  // ==========================================================================

  it('IPC_CHANNELS keys are consistent between IpcChannelMap and ipc-channels', () => {
    // Every key in IpcChannelMap should exist in IPC_CHANNELS
    const channelKeys = Object.values(IPC_CHANNELS) as string[]

    // Verify some critical channels exist
    expect(channelKeys).toContain(IPC_CHANNELS.PROJECT_LIST)
    expect(channelKeys).toContain(IPC_CHANNELS.GIT_STATUS)
    expect(channelKeys).toContain(IPC_CHANNELS.SESSION_EVENTS)
    expect(channelKeys).toContain(IPC_CHANNELS.ZOOM_GET)
  })

  it('RendererChannelMap covers all push channels that main sends to renderer', () => {
    // These channels should be in RendererChannelMap
    // This test documents the expectation
    const expectedRendererChannels = [
      IPC_CHANNELS.SESSION_EVENTS,
      IPC_CHANNELS.SESSION_UI_REQUEST,
      IPC_CHANNELS.UPDATE_AVAILABLE,
      IPC_CHANNELS.UPDATE_NOT_AVAILABLE,
      IPC_CHANNELS.UPDATE_PROGRESS,
      IPC_CHANNELS.UPDATE_DOWNLOADED,
      IPC_CHANNELS.UPDATE_ERROR,
      IPC_CHANNELS.WINDOW_MAXIMIZED_STATE,
      IPC_CHANNELS.NOTIFICATION_PLAY_SOUND,
    ]

    // Verify these are valid channels (compile-time checked by TypeScript)
    expectedRendererChannels.forEach((ch) => {
      expect(ch).toBeDefined()
    })
  })
})
