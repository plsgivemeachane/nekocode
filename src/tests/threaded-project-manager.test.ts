/**
 * CRITICAL TESTS for ThreadedProjectManager
 *
 * Contract Audit:
 * - Name implies "threaded" but most operations are delegated to the underlying
 *   ProjectManager on the main thread. This is a PARTIAL LIE.
 * - `loadWorkspace()` → offloads to worker queue, then applies results via restoreWorkspace(). THREADED.
 * - `addProject(path)` → delegates to projectManager.addProject(path). NOT threaded.
 * - `removeProject(id)` → delegates. NOT threaded.
 * - `listProjects()` → delegates (sync). NOT threaded.
 * - `refreshSessions(projectId)` → delegates. NOT threaded.
 * - `setActiveSession(sessionId, projectPath)` → delegates. NOT threaded.
 * - `getActiveSession()` → delegates (sync). NOT threaded.
 * - The operationQueue is injected but NEVER used by any method.
 *   This is dead dependency injection — the queue is accepted but ignored.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

vi.mock('../main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { ThreadedProjectManager } from '../main/threading/threaded-project-manager'
import type { ProjectInfo } from '../shared/ipc-types'

// ── Mock ProjectManager ──────────────────────────────────────────

function createMockProjectManager() {
  return {
    loadWorkspace: vi.fn(async () => {}),
    getWorkspacePath: vi.fn(() => '/test/workspace.json'),
    addProject: vi.fn<(path: string) => Promise<ProjectInfo>>(async (path) => ({
      id: 'proj-1',
      name: 'Test Project',
      path,
      sessions: [],
    })),
    removeProject: vi.fn(async () => true),
    listProjects: vi.fn<() => ProjectInfo[]>(() => []),
    refreshSessions: vi.fn<(projectId: string) => Promise<ProjectInfo | null>>(async () => ({
      id: 'proj-1',
      name: 'Test',
      path: '/test',
      sessions: [],
    })),
    setActiveSession: vi.fn(async () => {}),
    getActiveSession: vi.fn<() => { sessionId: string | null; projectPath: string | null }>(() => ({ sessionId: null, projectPath: null })),
    restoreWorkspace: vi.fn(async () => {}),
  }
}

function createMockQueue(mockProjectManager: ReturnType<typeof createMockProjectManager>) {
  return {
    // Mock execute — matches ThreadOperationQueue.execute signature
    // In test mode, delegates to the underlying projectManager to simulate worker behavior
    execute: vi.fn(async <TInput, TOutput>(type: string, input: TInput, _priority?: string): Promise<TOutput> => {
      // Simulate worker thread by delegating to the mock projectManager
      switch (type) {
        case 'project:load-workspace':
          await mockProjectManager.loadWorkspace()
          return undefined as unknown as TOutput
        case 'project:add':
          return mockProjectManager.addProject((input as { path: string }).path) as unknown as Promise<TOutput>
        default:
          return undefined as unknown as TOutput
      }
    }),
    getStats: vi.fn(),
    shutdown: vi.fn(async () => {}),
  }
}

describe('ThreadedProjectManager', () => {
  let mockProjectManager: ReturnType<typeof createMockProjectManager>
  let mockQueue: ReturnType<typeof createMockQueue>
  let manager: ThreadedProjectManager

  beforeEach(() => {
    mockProjectManager = createMockProjectManager()
    mockQueue = createMockQueue(mockProjectManager)
    manager = new ThreadedProjectManager(
      mockQueue as unknown as import('../main/threading/thread-operation-queue').ThreadOperationQueue,
      mockProjectManager as unknown as import('../main/project-manager').ProjectManager,
    )
  })

  // =========================================================================
  // DELEGATION CONTRACT — All methods delegate to underlying ProjectManager
  // =========================================================================

  describe('loadWorkspace', () => {
    it('delegates to operation queue with project:load-workspace type', async () => {
      await manager.loadWorkspace()
      expect(mockQueue.execute).toHaveBeenCalled()
      // Verify the operation type passed to execute
      const callArgs = mockQueue.execute.mock.calls[0]
      expect(callArgs[0]).toBe('project:load-workspace')
    })

    it('now correctly uses the operation queue', async () => {
      await manager.loadWorkspace()
      expect(mockQueue.execute).toHaveBeenCalled()
    })
  })

  describe('addProject', () => {
    it('delegates to operation queue with project:add type', async () => {
      const result = await manager.addProject('/my/project')
      expect(mockQueue.execute).toHaveBeenCalled()
      // Verify the operation type and input passed to execute
      const callArgs = mockQueue.execute.mock.calls[0]
      expect(callArgs[0]).toBe('project:add')
      expect(callArgs[1]).toEqual({ path: '/my/project' })
      expect(result).toEqual({
        id: 'proj-1',
        name: 'Test Project',
        path: '/my/project',
        sessions: [],
      })
    })

    it('now correctly uses the operation queue', async () => {
      await manager.addProject('/test')
      expect(mockQueue.execute).toHaveBeenCalled()
    })
  })

  describe('removeProject', () => {
    it('delegates to underlying projectManager.removeProject', async () => {
      const result = await manager.removeProject('proj-1')
      expect(mockProjectManager.removeProject).toHaveBeenCalledWith('proj-1')
      expect(result).toBe(true)
    })

    it('propagates errors from underlying manager', async () => {
      mockProjectManager.removeProject.mockRejectedValue(new Error('not found'))
      await expect(manager.removeProject('bad-id')).rejects.toThrow('not found')
    })

    it('does NOT use the operation queue', async () => {
      await manager.removeProject('proj-1')
      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })

  describe('listProjects', () => {
    it('delegates to underlying projectManager.listProjects', () => {
      mockProjectManager.listProjects.mockReturnValue([
        { id: 'p1', name: 'P1', path: '/p1', sessions: [] },
      ])

      const result = manager.listProjects()
      expect(result).toEqual([{ id: 'p1', name: 'P1', path: '/p1', sessions: [] }])
      expect(mockProjectManager.listProjects).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when no projects', () => {
      expect(manager.listProjects()).toEqual([])
    })

    it('does NOT use the operation queue', () => {
      manager.listProjects()
      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })

  describe('refreshSessions', () => {
    it('delegates to underlying projectManager.refreshSessions', async () => {
      const result = await manager.refreshSessions('proj-1')
      expect(mockProjectManager.refreshSessions).toHaveBeenCalledWith('proj-1')
      expect(result).toEqual({
        id: 'proj-1',
        name: 'Test',
        path: '/test',
        sessions: [],
      })
    })

    it('propagates null from underlying manager', async () => {
      mockProjectManager.refreshSessions.mockResolvedValue(null)
      const result = await manager.refreshSessions('nonexistent')
      expect(result).toBeNull()
    })

    it('propagates errors from underlying manager', async () => {
      mockProjectManager.refreshSessions.mockRejectedValue(new Error('refresh failed'))
      await expect(manager.refreshSessions('proj-1')).rejects.toThrow('refresh failed')
    })

    it('does NOT use the operation queue', async () => {
      await manager.refreshSessions('proj-1')
      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })

  describe('setActiveSession', () => {
    it('delegates to underlying projectManager.setActiveSession', async () => {
      await manager.setActiveSession('sess-1', '/project')
      expect(mockProjectManager.setActiveSession).toHaveBeenCalledWith('sess-1', '/project')
    })

    it('handles null values', async () => {
      await manager.setActiveSession(null, null)
      expect(mockProjectManager.setActiveSession).toHaveBeenCalledWith(null, null)
    })

    it('propagates errors from underlying manager', async () => {
      mockProjectManager.setActiveSession.mockRejectedValue(new Error('set failed'))
      await expect(manager.setActiveSession('s1', '/p')).rejects.toThrow('set failed')
    })

    it('does NOT use the operation queue', async () => {
      await manager.setActiveSession('s1', '/p')
      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })

  describe('getActiveSession', () => {
    it('delegates to underlying projectManager.getActiveSession', () => {
      mockProjectManager.getActiveSession.mockReturnValue({
        sessionId: 'sess-1',
        projectPath: '/project',
      })

      const result = manager.getActiveSession()
      expect(result).toEqual({ sessionId: 'sess-1', projectPath: '/project' })
      expect(mockProjectManager.getActiveSession).toHaveBeenCalledTimes(1)
    })

    it('returns null values when no active session', () => {
      const result = manager.getActiveSession()
      expect(result).toEqual({ sessionId: null, projectPath: null })
    })

    it('does NOT use the operation queue', () => {
      manager.getActiveSession()
      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // CRITICAL: The operation queue is accepted but NEVER used
  // This test documents the architectural gap
  // =========================================================================

  describe('operation queue is now used for async operations', () => {
    it('queue.execute is called for loadWorkspace and addProject', async () => {
      await manager.loadWorkspace()
      await manager.addProject('/test')
      // removeProject still delegates directly (not through queue)
      await manager.removeProject('id')
      manager.listProjects()
      await manager.refreshSessions('id')
      await manager.setActiveSession('s', 'p')
      manager.getActiveSession()

      // loadWorkspace and addProject should have triggered queue.execute
      expect(mockQueue.execute).toHaveBeenCalledTimes(2)
    })

    it('should use the operation queue for async operations — class name says "Threaded"', async () => {
      // CORRECT behavior: The class is named "ThreadedProjectManager" and
      // accepts an operationQueue in its constructor. It SHOULD use the queue
      // for at least some operations (ideally the async ones like loadWorkspace,
      // addProject, etc.) to fulfill its "threaded" contract.
      // Now fixed — loadWorkspace and addProject route through operationQueue.execute().
      await manager.loadWorkspace()
      await manager.addProject('/test')

      expect(mockQueue.execute).toHaveBeenCalled()
    })
  })
})
