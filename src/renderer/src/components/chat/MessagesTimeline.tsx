import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useState, useRef } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

/**
 * MessagesTimeline — virtualized message list powered by react-virtuoso.
 *
 * Key design decisions (see docs/research/virtual-scrolling-libraries.md):
 * - react-virtuoso manages its own scroll container, eliminating the
 *   fragile hybrid "virtualized prefix + unvirtualized tail" pattern
 *   that @tanstack/react-virtual required.
 * - followOutput="smooth" handles auto-scroll during streaming without
 *   manual ResizeObserver / scroll-position bookkeeping.
 * - atBottomStateChange replaces the manual isAtBottomRef tracking in
 *   useAutoScroll for the scroll-to-bottom button visibility.
 * - Dynamic row heights (code blocks, images, Shiki highlighting) are
 *   measured automatically by react-virtuoso — no custom ResizeObserver
 *   wiring needed.
 */

export interface MessagesTimelineHandle {
  /** Scroll to the bottom of the list */
  scrollToBottom: (smooth?: boolean) => void
}

// Using `any` for the row type to avoid TypeScript's forwardRef+generic
// limitation (TS cannot infer generic params through forwardRef).
// Consumers should type their renderRow callback parameter explicitly
// if they need type safety on the row data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessagesTimelineProps<T = any> = {
  rows: T[]
  isStreaming: boolean
  /** Called with (isAtBottom: boolean) when the user scrolls away from / back to bottom */
  atBottomStateChange?: (isAtBottom: boolean) => void
  getRowKey: (row: T, index: number) => string
  renderRow: (row: T, index: number) => React.ReactNode
}

// Cast through `any` to bridge forwardRef with generic props.
// This is a well-known TypeScript limitation — see:
// https://github.com/DefinitelyTyped/DefinitelyTyped/issues/34757
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MessagesTimeline = forwardRef<MessagesTimelineHandle, MessagesTimelineProps<any>>(
  function MessagesTimeline(
    { rows, isStreaming, atBottomStateChange, renderRow },
    ref,
  ) {
    const virtuosoRef = useRef<VirtuosoHandle>(null)

    useImperativeHandle(ref, () => ({
      scrollToBottom(smooth = false) {
        virtuosoRef.current?.scrollToIndex({
          index: rows.length - 1,
          align: 'end',
          behavior: smooth ? 'smooth' : 'auto',
        })
      },
    }))

    const itemContent = useCallback(
      (index: number) => {
        const row = rows[index]
        return <div className="pb-5">{renderRow(row, index)}</div>
      },
      [rows, renderRow],
    )

    // Scroll to bottom when switching to a new set of rows (session change)
    // by resetting initialTopMostItemIndex. Using a key on Virtuoso would
    // also work but causes a full remount; this is lighter.
    const prevLengthRef = useRef(rows.length)
    const [initialIndex, setInitialIndex] = useState(rows.length - 1)

    useEffect(() => {
      // Detect session switch: rows array was fully replaced (length dropped
      // or content changed entirely). A simple heuristic: if length decreased
      // significantly, snap to bottom.
      const prev = prevLengthRef.current
      if (rows.length === 0) {
        setInitialIndex(0)
      } else if (prev === 0 && rows.length > 0) {
        // First load: rows went from 0 to N — snap to bottom
        setInitialIndex(rows.length - 1)
      } else if (rows.length < prev * 0.5) {
        // Length dropped significantly — likely a session switch
        setInitialIndex(rows.length - 1)
      }
      prevLengthRef.current = rows.length
    }, [rows.length])

    if (rows.length === 0) {
      return null
    }

    return (
      <Virtuoso
        ref={virtuosoRef}
        data={rows}
        initialTopMostItemIndex={initialIndex}
        itemContent={itemContent}
        followOutput={isStreaming ? 'smooth' : false}
        atBottomStateChange={atBottomStateChange}
        atBottomThreshold={40}
        overscan={200}
        // Increase the default measured item size for code-heavy messages
        defaultItemHeight={100}
        className="outline-none"
      />
    )
  },
) as <T>(
  props: MessagesTimelineProps<T> & React.RefAttributes<MessagesTimelineHandle>,
) => React.ReactElement | null
