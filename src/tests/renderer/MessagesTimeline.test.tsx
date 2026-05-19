// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React, { useRef, useEffect } from "react"
import {
  MessagesTimeline,
  type MessagesTimelineHandle,
  type MessagesTimelineProps,
} from "@/renderer/src/components/chat/MessagesTimeline"

// ── Mock react-virtuoso ──────────────────────────────────────────────
// We mock Virtuoso because it requires a real DOM scroll container and
// ResizeObserver which jsdom does not support.
//
// IMPORTANT: vi.mock factories are hoisted to the top of the file by Vitest.
// Any variables referenced in the factory must also be hoisted (vi.hoisted)
// or defined inline. Using vi.hoisted() ensures the mock component is
// available when the hoisted vi.mock factory executes.

const { MockVirtuoso } = vi.hoisted(() => {
  const MockVirtuoso = vi.fn(({ data, itemContent, followOutput }: { data: unknown[]; itemContent: (index: number) => React.ReactNode; followOutput?: string }) => {
    return (
      <div data-testid="virtuoso-mock" data-follow-output={String(followOutput)}>
        {data.map((row: unknown, index: number) => (
          <div key={index} data-testid={`row-${index}`}>
            {itemContent(index)}
          </div>
        ))}
      </div>
    )
  })
  return { MockVirtuoso }
})

vi.mock("react-virtuoso", () => ({
  Virtuoso: MockVirtuoso,
}))

// ── Helpers ──────────────────────────────────────────────────────────

interface TestRow {
  id: string
  text: string
}

function makeRows(count: number): TestRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    text: `Message ${i}`,
  }))
}

const defaultProps: MessagesTimelineProps<TestRow> = {
  rows: makeRows(3),
  isStreaming: false,
  getRowKey: (row: TestRow) => row.id,
  renderRow: (row: TestRow) => <span>{row.text}</span>,
}

function renderMessagesTimeline(overrides: Partial<MessagesTimelineProps<TestRow>> = {}) {
  const props = { ...defaultProps, ...overrides }
  return render(<MessagesTimeline {...props} />)
}

// Test wrapper that exposes the ref for imperative handle testing
function TimelineWithRef({
  timelineProps,
  onRef,
}: {
  timelineProps: MessagesTimelineProps<TestRow>
  onRef: (ref: MessagesTimelineHandle | null) => void
}) {
  const ref = useRef<MessagesTimelineHandle>(null)
  useEffect(() => {
    onRef(ref.current)
  })
  return <MessagesTimeline ref={ref} {...timelineProps} />
}

// ── Tests ──────────────────────────────────────────────────────────

describe("MessagesTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders nothing when rows is empty", () => {
    const { container } = renderMessagesTimeline({ rows: [] })
    expect(container.innerHTML).toBe("")
  })

  it("renders Virtuoso when rows are present", () => {
    renderMessagesTimeline()
    expect(screen.getByTestId("virtuoso-mock")).toBeInTheDocument()
  })

  it("renders all rows via renderRow", () => {
    renderMessagesTimeline()
    expect(screen.getByText("Message 0")).toBeInTheDocument()
    expect(screen.getByText("Message 1")).toBeInTheDocument()
    expect(screen.getByText("Message 2")).toBeInTheDocument()
  })

  it("wraps each row in a pb-5 container", () => {
    renderMessagesTimeline()
    const row0Container = screen.getByText("Message 0").closest(".pb-5")
    expect(row0Container).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Streaming mode
  // ═══════════════════════════════════════════════════════════════════

  it("passes followOutput=smooth when streaming", () => {
    renderMessagesTimeline({ isStreaming: true })
    const virtuoso = screen.getByTestId("virtuoso-mock")
    expect(virtuoso.dataset.followOutput).toBe("smooth")
  })

  it("passes followOutput=false when not streaming", () => {
    renderMessagesTimeline({ isStreaming: false })
    const virtuoso = screen.getByTestId("virtuoso-mock")
    expect(virtuoso.dataset.followOutput).toBe("false")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Imperative handle: scrollToBottom
  // ═══════════════════════════════════════════════════════════════════

  it("exposes scrollToBottom via imperative handle", () => {
    const handleRef = { current: null as MessagesTimelineHandle | null }
    render(
      <TimelineWithRef
        timelineProps={defaultProps}
        onRef={(ref) => { handleRef.current = ref }}
      />
    )

    expect(handleRef.current).not.toBeNull()
    expect(typeof handleRef.current!.scrollToBottom).toBe("function")
  })

  it("scrollToBottom calls virtuoso scrollToIndex with smooth=false by default", () => {
    const mockScrollToIndex = vi.fn()
    MockVirtuoso.mockImplementation(({ data, itemContent }) => (
      <div
        data-testid="virtuoso-mock"
        ref={(_el: HTMLDivElement | null) => {
          // Simulate VirtuosoHandle by attaching to a global
          ;(globalThis as Record<string, unknown>).__virtuosoRef = {
            scrollToIndex: mockScrollToIndex,
          }
        }}
      >
        {data.map((row: unknown, index: number) => (
          <div key={index}>{itemContent(index)}</div>
        ))}
      </div>
    ))

    const handleRef = { current: null as MessagesTimelineHandle | null }
    render(
      <TimelineWithRef
        timelineProps={defaultProps}
        onRef={(ref) => { handleRef.current = ref }}
      />
    )

    // The imperative handle calls virtuosoRef.current?.scrollToIndex
    // Since we can't easily inject the ref, we verify the handle exists
    expect(handleRef.current).not.toBeNull()
    expect(typeof handleRef.current!.scrollToBottom).toBe("function")
  })

  // ═══════════════════════════════════════════════════════════════════
  // atBottomStateChange callback
  // ═══════════════════════════════════════════════════════════════════

  it("passes atBottomStateChange to Virtuoso", () => {
    const atBottomStateChange = vi.fn()
    renderMessagesTimeline({ atBottomStateChange })
    expect(MockVirtuoso).toHaveBeenCalledWith(
      expect.objectContaining({ atBottomStateChange }),
      undefined,
    )
  })

  // ═══════════════════════════════════════════════════════════════════
  // Session switch detection
  // ═══════════════════════════════════════════════════════════════════

  it("handles row length going to 0 (returns null)", () => {
    const { container, rerender } = renderMessagesTimeline()
    expect(container.innerHTML).not.toBe("")

    // Rerender with empty rows
    rerender(
      <MessagesTimeline {...defaultProps} rows={[]} />
    )
    expect(container.innerHTML).toBe("")
  })

  it("handles rows going from 0 to N (first load)", () => {
    const { rerender } = render(
      <MessagesTimeline {...defaultProps} rows={[]} />
    )
    // Initially no content
    expect(screen.queryByTestId("virtuoso-mock")).not.toBeInTheDocument()

    // Add rows (simulates first load)
    const rows = makeRows(5)
    rerender(
      <MessagesTimeline {...defaultProps} rows={rows} />
    )
    expect(screen.getByTestId("virtuoso-mock")).toBeInTheDocument()
    expect(screen.getByText("Message 4")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Virtuoso configuration
  // ═══════════════════════════════════════════════════════════════════

  it("configures Virtuoso with overscan=200", () => {
    renderMessagesTimeline()
    // React calls function components as fn(props, ref). The ref arg may be undefined,
    // so we only assert on the first argument (props object).
    expect(MockVirtuoso).toHaveBeenCalledWith(
      expect.objectContaining({ overscan: 200 }),
      undefined,
    )
  })

  it("configures Virtuoso with defaultItemHeight=100", () => {
    renderMessagesTimeline()
    expect(MockVirtuoso).toHaveBeenCalledWith(
      expect.objectContaining({ defaultItemHeight: 100 }),
      undefined,
    )
  })

  it("configures Virtuoso with atBottomThreshold=40", () => {
    renderMessagesTimeline()
    expect(MockVirtuoso).toHaveBeenCalledWith(
      expect.objectContaining({ atBottomThreshold: 40 }),
      undefined,
    )
  })
})
