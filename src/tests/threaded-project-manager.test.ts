/**
 * CRITICAL TESTS for ThreadedProjectManager
 *
 * Contract Audit:
 * - Name implies "threaded" but most operations are delegated to the underlying
 *   ProjectManager on the main thread. This is a PARTIAL LIE.
 * - `loadWorkspace()` → delegates to projectManager.loadWorkspace(). NOT threaded.
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
  }
}

function createMockQueue() {
  return {
    execute: vi.fn(),
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
    mockQueue = createMockQueue()
    manager = new ThreadedProjectManager(
      mockQueue as unknown as import('../main/threading/thread-operation-queue').ThreadOperationQueue,
      mockProjectManager as unknown as import('../main/project-manager').ProjectManager,
    )
  })

  // =========================================================================
  // DELEGATION CONTRACT — All methods delegate to underlying ProjectManager
  // =========================================================================

  describe('loadWorkspace', () => {
    it('delegates to underlying projectManager.loadWorkspace', async () => {
      await manager.loadWorkspace()
      expect(mockProjectManager.loadWorkspace).toHaveBeenCalledTimes(1)
    })

    it('propagates errors from underlying manager', async () => {
      mockProjectManager.loadWorkspace.mockRejectedValue(new Error('disk error'))
      await expect(manager.loadWorkspace()).rejects.toThrow('disk error')
    })

    it('does NOT use the operation queue', async () => {
      await manager.loadWorkspace()
      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })

  describe('addProject', () => {
    it('delegates to underlying projectManager.addProject', async () => {
      const result = await manager.addProject('/my/project')
      expect(mockProjectManager.addProject).toHaveBeenCalledWith('/my/project')
      expect(result).toEqual({
        id: 'proj-1',
        name: 'Test Project',
        path: '/my/project',
        sessions: [],
      })
    })

    it('propagates errors from underlying manager', async () => {
      mockProjectManager.addProject.mockRejectedValue(new Error('invalid path'))
      await expect(manager.addProject('/bad')).rejects.toThrow('invalid path')
    })

    it('does NOT use the operation queue', async () => {
      await manager.addProject('/test')
      expect(mockQueue.execute).not.toHaveBeenCalled()
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

  describe('operation queue is injected but unused', () => {
    it('never calls queue.execute for any operation', async () => {
      await manager.loadWorkspace()
      await manager.addProject('/test')
      await manager.removeProject('id')
      manager.listProjects()
      await manager.refreshSessions('id')
      await manager.setActiveSession('s', 'p')
      manager.getActiveSession()

      expect(mockQueue.execute).not.toHaveBeenCalled()
    })
  })
})
