import { describe, expect, it } from 'vitest'
import { getUnvirtualizedTailRows, getVirtualizedPrefixCount } from '@/renderer/src/components/chat/MessagesTimeline'

describe('MessagesTimeline split logic', () => {
  it('keeps a larger live tail while streaming', () => {
    expect(getUnvirtualizedTailRows(false)).toBe(24)
    expect(getUnvirtualizedTailRows(true)).toBe(48)
  })

  it('does not virtualize when rows are below tail size', () => {
    expect(getVirtualizedPrefixCount(10, false)).toBe(0)
    expect(getVirtualizedPrefixCount(30, true)).toBe(0)
  })

  it('virtualizes only the historical prefix', () => {
    expect(getVirtualizedPrefixCount(200, false)).toBe(176)
    expect(getVirtualizedPrefixCount(200, true)).toBe(152)
  })
})
