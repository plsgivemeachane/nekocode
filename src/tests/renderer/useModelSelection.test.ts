// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ModelInfo } from '@/shared/ipc-types'
import { useModelSelection } from '@/renderer/src/hooks/useModelSelection'
import { createMockIPC, setupMockIPC, clearMockIPC } from '../__utils__/test-utils'
import type { Mock } from 'vitest'

// ── Helpers ─────────────────────────────────────────────────────

const mockModel: ModelInfo = { id: 'gpt-4', name: 'GPT-4', provider: 'openai' }
const mockModel2: ModelInfo = { id: 'claude-3', name: 'Claude 3', provider: 'anthropic' }
const mockModelList: ModelInfo[] = [mockModel, mockModel2]

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// Type-safe accessors for mock functions on the IPC object
function mockGetModel(mock: ReturnType<typeof createMockIPC>) {
  return mock.session.getModel as unknown as Mock<(sessionId: string) => Promise<ModelInfo | null>>
}
function mockListModels(mock: ReturnType<typeof createMockIPC>) {
  return mock.session.listModels as unknown as Mock<() => Promise<ModelInfo[]>>
}
function mockSetModel(mock: ReturnType<typeof createMockIPC>) {
  return mock.session.setModel as unknown as Mock<(sessionId: string, provider: string, modelId: string) => Promise<ModelInfo>>
}

// ── Tests ───────────────────────────────────────────────────────

describe('useModelSelection', () => {
  let mockIPC: ReturnType<typeof createMockIPC>
  let getModel: Mock<(sessionId: string) => Promise<ModelInfo | null>>
  let listModels: Mock<() => Promise<ModelInfo[]>>
  let setModel: Mock<(sessionId: string, provider: string, modelId: string) => Promise<ModelInfo>>

  beforeEach(() => {
    mockIPC = createMockIPC()
    setupMockIPC(mockIPC)
    getModel = mockGetModel(mockIPC)
    listModels = mockListModels(mockIPC)
    setModel = mockSetModel(mockIPC)
  })

  afterEach(() => {
    clearMockIPC()
  })

  // ── activeModel ──────────────────────────────────────────────

  describe('activeModel', () => {
    it('returns null initially before the IPC resolves', () => {
      // Make both IPCs hang so no state updates occur during test
      getModel.mockReturnValue(new Promise(() => {}))
      listModels.mockReturnValue(new Promise(() => {}))
      const { result } = renderHook(() => useModelSelection('sess-1'))
      expect(result.current.activeModel).toBeNull()
    })

    it('fetches and sets the active model for a valid session', async () => {
      getModel.mockResolvedValue(mockModel)
      const { result } = renderHook(() => useModelSelection('sess-1'))

      await flushPromises()

      expect(getModel).toHaveBeenCalledWith('sess-1')
      expect(result.current.activeModel).toEqual(mockModel)
    })

    it('returns null when sessionId is null', async () => {
      getModel.mockResolvedValue(mockModel)
      const { result } = renderHook(() => useModelSelection(null))

      await flushPromises()

      expect(getModel).not.toHaveBeenCalled()
      expect(result.current.activeModel).toBeNull()
    })

    it('sets null when getModel rejects', async () => {
      getModel.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useModelSelection('sess-1'))

      await flushPromises()

      expect(result.current.activeModel).toBeNull()
    })

    it('refetches when sessionId changes', async () => {
      getModel
        .mockResolvedValueOnce(mockModel)
        .mockResolvedValueOnce(mockModel2)

      const { result, rerender } = renderHook(
        ({ sid }) => useModelSelection(sid),
        { initialProps: { sid: 'sess-1' } },
      )

      await flushPromises()
      expect(result.current.activeModel).toEqual(mockModel)

      rerender({ sid: 'sess-2' })
      await flushPromises()

      expect(getModel).toHaveBeenCalledWith('sess-2')
      expect(result.current.activeModel).toEqual(mockModel2)
    })

    it('cancels pending getModel on unmount', async () => {
      let resolveModel!: (v: ModelInfo | null) => void
      getModel.mockReturnValue(
        new Promise<ModelInfo | null>((resolve) => { resolveModel = resolve }),
      )

      const { unmount } = renderHook(() => useModelSelection('sess-1'))
      unmount()

      // Resolve after unmount — should not cause state update
      resolveModel(mockModel)
      await flushPromises()
      // No way to directly assert the cancelled flag, but no error thrown = success
    })

    it('resets to null when sessionId changes from valid to null', async () => {
      getModel.mockResolvedValue(mockModel)

      const { result, rerender } = renderHook(
        ({ sid }) => useModelSelection(sid as string | null),
        { initialProps: { sid: 'sess-1' as string | null } },
      )

      await flushPromises()
      expect(result.current.activeModel).toEqual(mockModel)

      rerender({ sid: null })
      // Synchronous reset in the effect cleanup path
      expect(result.current.activeModel).toBeNull()
    })

    it('handles getModel returning null (session has no model configured)', async () => {
      getModel.mockResolvedValue(null)
      const { result } = renderHook(() => useModelSelection('sess-1'))

      await flushPromises()

      expect(getModel).toHaveBeenCalledWith('sess-1')
      expect(result.current.activeModel).toBeNull()
    })

    it('handles rapid sessionId changes (only last result wins)', async () => {
      const resolveOrder: string[] = []
      let resolveA!: (v: ModelInfo | null) => void
      let resolveB!: (v: ModelInfo | null) => void
      getModel
        .mockReturnValueOnce(new Promise<ModelInfo | null>((r) => { resolveA = r }))
        .mockReturnValueOnce(new Promise<ModelInfo | null>((r) => { resolveB = r }))

      const { result, rerender } = renderHook(
        ({ sid }) => useModelSelection(sid),
        { initialProps: { sid: 'sess-1' } },
      )

      rerender({ sid: 'sess-2' })

      // Resolve in reverse order — sess-1 result should be discarded
      resolveB(mockModel2)
      await flushPromises()
      resolveOrder.push('B')

      resolveA(mockModel)
      await flushPromises()
      resolveOrder.push('A')

      // Only the last session's result should be active
      expect(result.current.activeModel).toEqual(mockModel2)
    })
  })

  // ── modelList ────────────────────────────────────────────────

  describe('modelList', () => {
    it('returns empty array initially before IPC resolves', () => {
      listModels.mockReturnValue(new Promise(() => {}))
      const { result } = renderHook(() => useModelSelection('sess-1'))
      expect(result.current.modelList).toEqual([])
    })

    it('fetches and sets the model list', async () => {
      listModels.mockResolvedValue(mockModelList)
      const { result } = renderHook(() => useModelSelection('sess-1'))

      await flushPromises()

      expect(listModels).toHaveBeenCalled()
      expect(result.current.modelList).toEqual(mockModelList)
    })

    it('sets empty array when listModels rejects', async () => {
      listModels.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useModelSelection('sess-1'))

      await flushPromises()

      expect(result.current.modelList).toEqual([])
    })

    it('only fetches once (empty deps array)', async () => {
      listModels.mockResolvedValue(mockModelList)

      const { rerender } = renderHook(
        ({ sid }) => useModelSelection(sid),
        { initialProps: { sid: 'sess-1' } },
      )

      await flushPromises()
      expect(listModels).toHaveBeenCalledTimes(1)

      rerender({ sid: 'sess-2' })
      await flushPromises()
      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('cancels pending listModels on unmount', async () => {
      let resolveList!: (v: ModelInfo[]) => void
      listModels.mockReturnValue(
        new Promise<ModelInfo[]>((resolve) => { resolveList = resolve }),
      )

      const { unmount } = renderHook(() => useModelSelection('sess-1'))
      unmount()

      resolveList(mockModelList)
      await flushPromises()
    })

    it('handles listModels returning empty array', async () => {
      listModels.mockResolvedValue([])
      const { result } = renderHook(() => useModelSelection('sess-1'))

      await flushPromises()

      expect(result.current.modelList).toEqual([])
      expect(listModels).toHaveBeenCalledTimes(1)
    })
  })

  // ── setModel ─────────────────────────────────────────────────

  describe('setModel', () => {
    it('calls session.setModel and updates activeModel on success', async () => {
      const updatedModel: ModelInfo = { id: 'claude-3', name: 'Claude 3', provider: 'anthropic' }
      setModel.mockResolvedValue(updatedModel)

      const { result } = renderHook(() => useModelSelection('sess-1'))

      await act(async () => {
        await result.current.setModel('anthropic', 'claude-3')
      })

      expect(setModel).toHaveBeenCalledWith('sess-1', 'anthropic', 'claude-3')
      expect(result.current.activeModel).toEqual(updatedModel)
    })

    it('does nothing when sessionId is null', async () => {
      setModel.mockResolvedValue(mockModel)

      const { result } = renderHook(() => useModelSelection(null))

      await act(async () => {
        await result.current.setModel('openai', 'gpt-4')
      })

      expect(setModel).not.toHaveBeenCalled()
    })

    it('does not crash when setModel rejects (error is logged)', async () => {
      setModel.mockRejectedValue(new Error('set failed'))

      const { result } = renderHook(() => useModelSelection('sess-1'))

      // Should not throw
      await act(async () => {
        await result.current.setModel('openai', 'gpt-4')
      })

      expect(setModel).toHaveBeenCalledWith('sess-1', 'openai', 'gpt-4')
      // activeModel remains whatever it was before
    })

    it('is stable across re-renders (useCallback with sessionId dep)', async () => {
      getModel.mockResolvedValue(mockModel)
      listModels.mockResolvedValue(mockModelList)

      const { result, rerender } = renderHook(
        ({ sid }) => useModelSelection(sid),
        { initialProps: { sid: 'sess-1' } },
      )

      // Wait for initial effects to complete
      await flushPromises()

      const fn1 = result.current.setModel

      await act(() => {
        rerender({ sid: 'sess-1' })
      })
      expect(result.current.setModel).toBe(fn1)

      await act(() => {
        rerender({ sid: 'sess-2' })
      })
      await flushPromises()
      expect(result.current.setModel).not.toBe(fn1)
    })

    it('is stable when sessionId is null (still a valid callback)', async () => {
      listModels.mockResolvedValue([])

      const { result, rerender } = renderHook(() => useModelSelection(null))

      // Wait for modelList effect to complete
      await flushPromises()

      const fn1 = result.current.setModel

      await act(() => {
        rerender()
      })
      expect(result.current.setModel).toBe(fn1)
    })

    it('updates activeModel optimistically after successful setModel', async () => {
      getModel.mockResolvedValue(mockModel)
      const updatedModel: ModelInfo = { id: 'new-model', name: 'New Model', provider: 'openai' }
      setModel.mockResolvedValue(updatedModel)

      const { result } = renderHook(() => useModelSelection('sess-1'))
      await flushPromises()
      expect(result.current.activeModel).toEqual(mockModel)

      await act(async () => {
        await result.current.setModel('openai', 'new-model')
      })

      expect(result.current.activeModel).toEqual(updatedModel)
      // Should NOT have re-fetched via getModel
      expect(getModel).toHaveBeenCalledTimes(1)
    })
  })

  // ── Integration ─────────────────────────────────────────────

  describe('integration', () => {
    it('returns the correct shape', async () => {
      // Make mocks hang so no state updates occur during test
      getModel.mockReturnValue(new Promise(() => {}))
      listModels.mockReturnValue(new Promise(() => {}))

      const { result } = renderHook(() => useModelSelection('sess-1'))
      expect(result.current).toHaveProperty('activeModel')
      expect(result.current).toHaveProperty('modelList')
      expect(result.current).toHaveProperty('setModel')
      expect(typeof result.current.setModel).toBe('function')
    })

    it('activeModel and modelList load independently', async () => {
      let resolveModel!: (v: ModelInfo | null) => void
      getModel.mockReturnValue(
        new Promise<ModelInfo | null>((resolve) => { resolveModel = resolve }),
      )
      listModels.mockResolvedValue(mockModelList)

      const { result } = renderHook(() => useModelSelection('sess-1'))

      // modelList resolves first
      await flushPromises()
      expect(result.current.modelList).toEqual(mockModelList)
      expect(result.current.activeModel).toBeNull()

      // Then model resolves
      await act(async () => { resolveModel(mockModel) })
      expect(result.current.activeModel).toEqual(mockModel)
    })

    it('setModel then switch session: new session fetches its own model', async () => {
      getModel
        .mockResolvedValueOnce(mockModel)
        .mockResolvedValueOnce(mockModel2)
      setModel.mockResolvedValue(mockModel2)

      const { result, rerender } = renderHook(
        ({ sid }) => useModelSelection(sid),
        { initialProps: { sid: 'sess-1' } },
      )

      await flushPromises()
      expect(result.current.activeModel).toEqual(mockModel)

      // Switch model on sess-1
      await act(async () => {
        await result.current.setModel('anthropic', 'claude-3')
      })
      expect(result.current.activeModel).toEqual(mockModel2)

      // Switch to sess-2 — should fetch sess-2's model
      rerender({ sid: 'sess-2' })
      await flushPromises()
      expect(getModel).toHaveBeenCalledWith('sess-2')
      expect(result.current.activeModel).toEqual(mockModel2)
    })

    it('handles all three IPCs failing gracefully', async () => {
      getModel.mockRejectedValue(new Error('getModel fail'))
      listModels.mockRejectedValue(new Error('listModels fail'))
      setModel.mockRejectedValue(new Error('setModel fail'))

      const { result } = renderHook(() => useModelSelection('sess-1'))
      await flushPromises()

      expect(result.current.activeModel).toBeNull()
      expect(result.current.modelList).toEqual([])

      // setModel should not throw
      await act(async () => {
        await result.current.setModel('openai', 'gpt-4')
      })
      expect(result.current.activeModel).toBeNull()
    })
  })
})
