// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectProvider, useProjectStore } from '@/renderer/src/stores/project-store'
import { clearMockIPC, createEventEmitter, setupMockIPC } from '../__utils__/test-utils'

describe('f3746fa: real project provider event and layout contracts', () => {
  let ipc: ReturnType<typeof setupMockIPC>
  let events: ReturnType<typeof createEventEmitter>

  beforeEach(() => {
    ipc = setupMockIPC()
    events = createEventEmitter()
    vi.mocked(ipc.session.onEvent).mockImplementation(events.subscribe)
  })

  afterEach(() => { cleanup(); clearMockIPC() })

  async function mount() {
    const hook = renderHook(() => useProjectStore(), { wrapper: ProjectProvider })
    await act(async () => {})
    return hook
  }

  it('marks only a background completion unread and clears only the selected session', async () => {
    const { result } = await mount()
    act(() => result.current.setActiveSession('foreground', '/project'))
    act(() => {
      events.emit({ sessionId: 'foreground', event: { type: 'done' } })
      events.emit({ sessionId: 'background', event: { type: 'done' } })
      events.emit({ sessionId: 'other', event: { type: 'done' } })
    })
    expect(result.current.state.sessionStatuses).toMatchObject({ foreground: 'idle', background: 'finished_unread', other: 'finished_unread' })
    act(() => result.current.setActiveSession('background', '/project'))
    expect(result.current.state.sessionStatuses).toMatchObject({ background: 'idle', other: 'finished_unread' })
  })

  it('does not mark a completion unread when selection and completion share one event turn', async () => {
    const { result } = await mount()
    act(() => result.current.setActiveSession('previous', '/project'))
    act(() => {
      result.current.setActiveSession('next', '/project')
      events.emit({ sessionId: 'next', event: { type: 'done' } })
    })
    expect(result.current.state.activeSessionId).toBe('next')
    expect(result.current.state.sessionStatuses.next).toBe('idle')
  })

  it('keeps an existing streaming or error status when its session is selected', async () => {
    const { result } = await mount()
    act(() => {
      events.emit({ sessionId: 'stream', event: { type: 'agent_start' } })
      events.emit({ sessionId: 'failed', event: { type: 'error', message: 'provider unavailable' } })
    })
    act(() => result.current.setActiveSession('stream', '/project'))
    expect(result.current.state.sessionStatuses.stream).toBe('streaming')
    act(() => result.current.setActiveSession('failed', '/project'))
    expect(result.current.state.sessionStatuses.failed).toBe('error')
    expect(result.current.state.sessionErrorMessages.failed).toBe('provider unavailable')
  })

  it('removes the event subscription on unmount and attaches one on remount', async () => {
    const first = await mount()
    expect(events.getListenerCount()).toBe(1)
    first.unmount()
    expect(events.getListenerCount()).toBe(0)
    await mount()
    expect(events.getListenerCount()).toBe(1)
  })

  it.each([
    [-100, 180], [179, 180], [180, 180], [321.5, 321.5], [500, 500], [501, 500],
    [Number.NaN, 240], [Number.POSITIVE_INFINITY, 240], [Number.NEGATIVE_INFINITY, 240],
  ])('bounds the actual left sidebar width for %s to %s', async (input, expected) => {
    const { result } = await mount()
    act(() => result.current.setLeftSidebarWidth(input))
    expect(result.current.state.leftSidebarWidth).toBe(expected)
  })

  it('preserves a tool selection when opening a panel and clears it when explicitly requested', async () => {
    const { result } = await mount()
    act(() => result.current.setRightSidebarPanel('diff', 'tool-1'))
    act(() => result.current.setRightSidebarPanel('diff'))
    expect(result.current.state.rightSidebarSelectedToolCallId).toBe('tool-1')
    act(() => result.current.setRightSidebarPanel('diff', null))
    expect(result.current.state.rightSidebarSelectedToolCallId).toBeNull()
    act(() => result.current.setRightSidebarPanel('diff', 'tool-2'))
    act(() => result.current.setRightSidebarPanel(null))
    expect(result.current.state.rightSidebarSelectedToolCallId).toBeNull()
  })
})
