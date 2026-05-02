// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useClickOutside } from '@/renderer/src/hooks/useClickOutside'

describe('useClickOutside', () => {
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener')
    removeSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mousedownAddCalls = () =>
    addSpy.mock.calls.filter((c: unknown[]) => c[0] === 'mousedown')
  const mousedownRemoveCalls = () =>
    removeSpy.mock.calls.filter((c: unknown[]) => c[0] === 'mousedown')

  it('does not add mousedown listener when isOpen is false', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    renderHook(() => useClickOutside(ref, false, handler))
    expect(mousedownAddCalls()).toHaveLength(0)
  })

  it('adds mousedown listener when isOpen is true', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    renderHook(() => useClickOutside(ref, true, handler))
    expect(mousedownAddCalls()).toHaveLength(1)
    expect(mousedownAddCalls()[0][1]).toBeInstanceOf(Function)
  })

  it('removes mousedown listener on unmount', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    const { unmount } = renderHook(() => useClickOutside(ref, true, handler))
    unmount()
    expect(mousedownRemoveCalls()).toHaveLength(1)
  })

  it('calls handler when click is outside the ref element', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    renderHook(() => useClickOutside(ref, true, handler))
    const listener = mousedownAddCalls()[0][1] as EventListener
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: document.createElement('div') })
    listener(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not call handler when click is inside the ref element', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    renderHook(() => useClickOutside(ref, true, handler))
    const listener = mousedownAddCalls()[0][1] as EventListener
    const child = document.createElement('span')
    ref.current!.appendChild(child)
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: child })
    listener(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not call handler when ref.current is null', () => {
    const ref = { current: null as unknown as HTMLElement }
    const handler = vi.fn()
    renderHook(() => useClickOutside(ref, true, handler))
    const listener = mousedownAddCalls()[0][1] as EventListener
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: document.body })
    listener(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('adds listener when isOpen changes false→true', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    const { rerender } = renderHook(
      ({ isOpen }) => useClickOutside(ref, isOpen, handler),
      { initialProps: { isOpen: false } },
    )
    expect(mousedownAddCalls()).toHaveLength(0)
    rerender({ isOpen: true })
    expect(mousedownAddCalls()).toHaveLength(1)
  })

  it('removes listener when isOpen changes true→false', () => {
    const ref = { current: document.createElement('div') }
    const handler = vi.fn()
    const { rerender } = renderHook(
      ({ isOpen }) => useClickOutside(ref, isOpen, handler),
      { initialProps: { isOpen: true } },
    )
    rerender({ isOpen: false })
    expect(mousedownRemoveCalls()).toHaveLength(1)
  })
})
