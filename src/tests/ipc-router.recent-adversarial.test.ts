import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handle, removeHandler, windows, validate } = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  windows: vi.fn(),
  validate: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle, removeHandler },
  BrowserWindow: { getAllWindows: windows },
}))
vi.mock('../main/security-utils', () => ({ validateIpcSender: validate }))

import { IpcRouter } from '../main/ipc-router'
import { IPC_CHANNELS } from '../shared/ipc-channels'

describe('IpcRouter recent adversarial cases', () => {
  beforeEach(() => {
    handle.mockReset()
    removeHandler.mockReset()
    windows.mockReset()
    validate.mockReset()
  })

  it('validates the sender before invoking a registered handler and passes payload unchanged', async () => {
    const router = new IpcRouter()
    const handler = vi.fn().mockResolvedValue(['project'])
    router.handle(IPC_CHANNELS.PROJECT_LIST, handler)
    const registered = handle.mock.calls[0][1]
    const event = { sender: { id: 42 } }
    const payload = { unexpected: true }

    const result = await registered(event, payload)

    expect(validate).toHaveBeenCalledWith(event)
    expect(handler).toHaveBeenCalledWith(payload)
    expect(result).toEqual(['project'])
    expect(validate.mock.invocationCallOrder[0]).toBeLessThan(handler.mock.invocationCallOrder[0])
  })

  it('does not invoke the handler when sender validation rejects', async () => {
    validate.mockImplementation(() => { throw new Error('untrusted sender') })
    const router = new IpcRouter()
    const handler = vi.fn()
    router.handle(IPC_CHANNELS.PROJECT_LIST, handler)
    const registered = handle.mock.calls[0][1]

    await expect(registered({ sender: { id: 7 } }, undefined)).rejects.toThrow('untrusted sender')
    expect(handler).not.toHaveBeenCalled()
  })
})
