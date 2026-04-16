import React, { useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 24
const STREAMING_UNVIRTUALIZED_TAIL_ROWS = 48
const ESTIMATED_ROW_HEIGHT_PX = 100
const OVERSCAN_ROWS = 8

export function getUnvirtualizedTailRows(isStreaming: boolean): number {
  return isStreaming ? STREAMING_UNVIRTUALIZED_TAIL_ROWS : ALWAYS_UNVIRTUALIZED_TAIL_ROWS
}

export function getVirtualizedPrefixCount(totalRows: number, isStreaming: boolean): number {
  return Math.max(0, totalRows - getUnvirtualizedTailRows(isStreaming))
}

interface MessagesTimelineProps<TRow> {
  rows: TRow[]
  isStreaming: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  getRowKey: (row: TRow, index: number) => string
  renderRow: (row: TRow, index: number) => React.ReactNode
}

export function MessagesTimeline<TRow>({
  rows,
  isStreaming,
  scrollContainerRef,
  getRowKey,
  renderRow,
}: MessagesTimelineProps<TRow>) {
  const virtualizedPrefixCount = getVirtualizedPrefixCount(rows.length, isStreaming)
  const virtualRows = rows.slice(0, virtualizedPrefixCount)
  const liveTailRows = rows.slice(virtualizedPrefixCount)

  const rowVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  useEffect(() => {
    const scrollElement = scrollContainerRef.current
    if (!scrollElement) return

    const observer = new ResizeObserver(() => {
      rowVirtualizer.measure()
    })

    const onLoadCapture = (event: Event) => {
      if (event.target instanceof HTMLImageElement) {
        rowVirtualizer.measure()
      }
    }

    observer.observe(scrollElement)
    scrollElement.addEventListener('load', onLoadCapture, true)

    return () => {
      observer.disconnect()
      scrollElement.removeEventListener('load', onLoadCapture, true)
    }
  }, [rowVirtualizer, scrollContainerRef])

  return (
    <div>
      {virtualRows.length > 0 && (
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = virtualRows[virtualRow.index]
            return (
              <div
                key={getRowKey(row, virtualRow.index)}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="pb-5"
              >
                {renderRow(row, virtualRow.index)}
              </div>
            )
          })}
        </div>
      )}

      {liveTailRows.map((row, index) => {
        const absoluteIndex = virtualizedPrefixCount + index
        return (
          <div key={getRowKey(row, absoluteIndex)} className="pb-5">
            {renderRow(row, absoluteIndex)}
          </div>
        )
      })}
    </div>
  )
}
