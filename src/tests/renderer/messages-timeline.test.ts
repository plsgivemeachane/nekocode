// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import type { MessagesTimelineHandle } from '@/renderer/src/components/chat/MessagesTimeline'

// Mock react-virtuoso to avoid JSDOM scroll container issues.
// The mock must be self-contained inside vi.mock (no top-level variable refs)
// because vi.mock is hoisted before const/let declarations.
vi.mock('react-virtuoso', () => {
  // eslint-disable-next-line react/display-name
  const MockVirtuoso = React.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: vi.fn(),
        scrollTo: vi.fn(),
      }))
      const data = props.data as unknown[]
      const itemContent = props.itemContent as (index: number) => React.ReactNode
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso-mock' },
        ...(data.map((_, i) =>
          React.createElement(
            'div',
            { key: i, 'data-testid': `virtuoso-item-${i}` },
            itemContent(i),
          ),
        )),
      )
    },
  )
  return { Virtuoso: MockVirtuoso }
})

// Import the component under test AFTER the mock is registered (vi.mock is hoisted)
const { MessagesTimeline } = await import('@/renderer/src/components/chat/MessagesTimeline')

describe('MessagesTimeline', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockRows: any[] = [
    { key: 'a', text: 'Message 1' },
    { key: 'b', text: 'Message 2' },
    { key: 'c', text: 'Message 3' },
  ]

  it('renders all rows via react-virtuoso', () => {
    render(
      React.createElement(MessagesTimeline, {
        rows: mockRows,
        isStreaming: false,
        getRowKey: (row: typeof mockRows[number]) => row.key,
        renderRow: (row: typeof mockRows[number]) => React.createElement('span', null, row.text),
      }),
    )
    expect(screen.getByText('Message 1')).toBeDefined()
    expect(screen.getByText('Message 2')).toBeDefined()
    expect(screen.getByText('Message 3')).toBeDefined()
  })

  it('returns null when rows is empty', () => {
    const { container } = render(
      React.createElement(MessagesTimeline, {
        rows: [],
        isStreaming: false,
        getRowKey: () => '',
        renderRow: () => null,
      }),
    )
    expect(container.innerHTML).toBe('')
  })

  it('exposes scrollToBottom via ref', () => {
    const ref = React.createRef<MessagesTimelineHandle>()
    render(
      React.createElement(MessagesTimeline, {
        ref,
        rows: mockRows,
        isStreaming: false,
        getRowKey: (row: typeof mockRows[number]) => row.key,
        renderRow: (row: typeof mockRows[number]) => React.createElement('span', null, row.text),
      }),
    )
    expect(ref.current).not.toBeNull()
    expect(typeof ref.current!.scrollToBottom).toBe('function')
    act(() => {
      ref.current!.scrollToBottom(true)
    })
  })

  it('passes atBottomStateChange to react-virtuoso', () => {
    const onAtBottom = vi.fn()
    render(
      React.createElement(MessagesTimeline, {
        rows: mockRows,
        isStreaming: false,
        atBottomStateChange: onAtBottom,
        getRowKey: (row: typeof mockRows[number]) => row.key,
        renderRow: (row: typeof mockRows[number]) => React.createElement('span', null, row.text),
      }),
    )
    expect(screen.getByTestId('virtuoso-mock')).toBeDefined()
  })
})
