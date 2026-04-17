import { describe, it, expect } from 'vitest'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

describe('IPC_CHANNELS', () => {
  const channels = IPC_CHANNELS
  const allValues = Object.values(channels)

  it('has expected number of channels', () => {
    expect(allValues).toHaveLength(27)
  })

  it('has no duplicate values', () => {
    expect(new Set(allValues).size).toBe(allValues.length)
  })

  it('all values follow colon-separated naming convention', () => {
    for (const v of allValues) {
      expect(typeof v).toBe('string')
      expect(v).toMatch(/^[a-z][a-z0-9]*:[a-zA-Z][a-zA-Z0-9-]*$/)
    }
  })

  it('all values are unique strings', () => {
    for (const v of allValues) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })

  it('has all session channels', () => {
    expect(channels).toHaveProperty('SESSION_CREATE')
    expect(channels).toHaveProperty('SESSION_PROMPT')
    expect(channels).toHaveProperty('SESSION_EVENTS')
    expect(channels).toHaveProperty('SESSION_ABORT')
    expect(channels).toHaveProperty('SESSION_DISPOSE')
    expect(channels).toHaveProperty('SESSION_RECONNECT')
    expect(channels).toHaveProperty('SESSION_LOAD_HISTORY')
    expect(channels).toHaveProperty('SESSION_LOAD_HISTORY_DISK')
  })

  it('has all dialog channels', () => {
    expect(channels).toHaveProperty('DIALOG_OPEN_FOLDER')
  })

  it('has all project channels', () => {
    expect(channels).toHaveProperty('PROJECT_ADD')
    expect(channels).toHaveProperty('PROJECT_REMOVE')
    expect(channels).toHaveProperty('PROJECT_LIST')
    expect(channels).toHaveProperty('PROJECT_SESSIONS')
  })

  it('has all workspace channels', () => {
    expect(channels).toHaveProperty('WORKSPACE_SET_ACTIVE')
    expect(channels).toHaveProperty('WORKSPACE_GET_ACTIVE')
  })

  it('has all update channels', () => {
    expect(channels).toHaveProperty('UPDATE_CHECK')
    expect(channels).toHaveProperty('UPDATE_DOWNLOAD')
    expect(channels).toHaveProperty('UPDATE_INSTALL')
    expect(channels).toHaveProperty('UPDATE_AVAILABLE')
    expect(channels).toHaveProperty('UPDATE_NOT_AVAILABLE')
    expect(channels).toHaveProperty('UPDATE_PROGRESS')
    expect(channels).toHaveProperty('UPDATE_DOWNLOADED')
    expect(channels).toHaveProperty('UPDATE_ERROR')
  })

  it('update channels all start with "update:"', () => {
    const updateChannels = allValues.filter(v => v.startsWith('update:'))
    expect(updateChannels).toHaveLength(8)
  })

  it('session channels all start with "session:"', () => {
    const sessionChannels = allValues.filter(v => v.startsWith('session:'))
    expect(sessionChannels).toHaveLength(12)
  })

  it('IpcChannel type is a union of all values', () => {
    // This is a compile-time check, but we verify runtime shape
    const keys = Object.keys(channels)
    expect(keys).toEqual([
      'SESSION_CREATE',
      'SESSION_PROMPT',
      'SESSION_EVENTS',
      'SESSION_ABORT',
      'SESSION_DISPOSE',
      'SESSION_DELETE',
      'SESSION_RECONNECT',
      'SESSION_LOAD_HISTORY',
      'SESSION_LOAD_HISTORY_DISK',
      'DIALOG_OPEN_FOLDER',
      'PROJECT_ADD',
      'PROJECT_REMOVE',
      'PROJECT_LIST',
      'PROJECT_SESSIONS',
      'WORKSPACE_SET_ACTIVE',
      'WORKSPACE_GET_ACTIVE',
      'SESSION_GET_MODEL',
      'SESSION_LIST_MODELS',
      'SESSION_SET_MODEL',
      'UPDATE_CHECK',
      'UPDATE_DOWNLOAD',
      'UPDATE_INSTALL',
      'UPDATE_AVAILABLE',
      'UPDATE_NOT_AVAILABLE',
      'UPDATE_PROGRESS',
      'UPDATE_DOWNLOADED',
      'UPDATE_ERROR',
    ])
  })
})
