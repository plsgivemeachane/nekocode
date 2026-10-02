// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPatch } from 'diff'
import { SessionDiffView, type DiffEntry } from '@/renderer/src/components/chat/SessionDiffView'

const boundary = vi.hoisted(() => ({
  scroll: vi.fn(),
  patches: vi.fn(),
  visibleIndex: 0,
}))

// Exercise the component's lazy rendering and imperative scrolling contracts;
// jsdom cannot establish the real virtualizer's browser layout or performance.
vi.mock('react-virtuoso', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const Virtuoso = forwardRef(function VirtualizerBoundary(
    { data, itemContent }: { data: DiffEntry[]; itemContent: (index: number) => React.ReactNode }, ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollToIndex: boundary.scroll }))
    return <div data-testid="virtualizer" data-count={data.length}>{itemContent(boundary.visibleIndex)}</div>
  })
  return { Virtuoso }
})

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: (props: { patch: string; options: { diffStyle: string } }) => {
    boundary.patches(props)
    return <pre data-testid="patch">{props.patch}</pre>
  },
}))

function entry(id: string): DiffEntry {
  return { id, filePath: `/src/${id}.ts`, toolName: 'edit', oldContent: 'old\n', newContent: 'new\n', stats: { added: 1, removed: 1 } }
}

describe('f3746fa: session diff virtualizer boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); boundary.visibleIndex = 0 })
  afterEach(cleanup)

  it('scrolls to a selected offscreen entry without eagerly building every patch', () => {
    const entries = Array.from({ length: 100 }, (_, index) => entry(`entry-${index}`))
    render(<SessionDiffView entries={entries} selectedId="entry-99" />)
    expect(boundary.scroll).toHaveBeenCalledExactlyOnceWith({ index: 99, align: 'start', behavior: 'smooth' })
    expect(screen.getByTestId('virtualizer')).toHaveAttribute('data-count', '100')
    expect(boundary.patches).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('patch')).toHaveTextContent('/src/entry-0.ts')
  })

  it('recalculates the selected index after entries reorder', () => {
    const a = entry('a')
    const b = entry('b')
    const { rerender } = render(<SessionDiffView entries={[a, b]} selectedId="b" />)
    expect(boundary.scroll).toHaveBeenLastCalledWith({ index: 1, align: 'start', behavior: 'smooth' })
    rerender(<SessionDiffView entries={[b, a]} selectedId="b" />)
    expect(boundary.scroll).toHaveBeenLastCalledWith({ index: 0, align: 'start', behavior: 'smooth' })
    expect(screen.getByTestId('patch')).toHaveTextContent('/src/b.ts')
  })

  it('ignores a selected ID that is no longer present', () => {
    render(<SessionDiffView entries={[entry('a')]} selectedId="removed" />)
    expect(boundary.scroll).not.toHaveBeenCalled()
  })

  it.each([
    ['unicode and missing final newline', 'const cat = "猫"', 'const cat = "🐈"\n'],
    ['new file', '', 'new file\n'],
    ['deleted file', 'old file\n', ''],
  ])('produces an applicable real patch for %s', (_label, oldContent, newContent) => {
    render(<SessionDiffView entries={[{ ...entry('a'), oldContent, newContent }]} />)
    const patch = boundary.patches.mock.calls[0][0].patch as string
    expect(applyPatch(oldContent, patch)).toBe(newContent)
  })

  it('preserves entry identity when the visible index changes and the user selects it', () => {
    boundary.visibleIndex = 1
    const onSelectEntry = vi.fn()
    render(<SessionDiffView entries={[entry('a'), entry('b')]} onSelectEntry={onSelectEntry} />)
    fireEvent.click(screen.getByTestId('patch'))
    expect(onSelectEntry).toHaveBeenCalledExactlyOnceWith('b')
  })
})
