import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProjectManager } from '../main/project-manager'

const fsState = {
  readData: '' as string,
  readError: null as Error | null,
}

// Mock Electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (fsState.readError) throw fsState.readError
    return fsState.readData
  }),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}))

// Mock SessionManager.list to return controlled data
vi.mock('@mariozechner/pi-coding-agent', () => ({
  SessionManager: {
    list: vi.fn(),
  },
}))

// Import the mocked module so we can control return values
import { SessionManager } from '@mariozechner/pi-coding-agent'
import { readFile, writeFile, mkdir } from 'fs/promises'

const mockedList = vi.mocked(SessionManager.list)
const mockedReadFile = vi.mocked(readFile)
const mockedWriteFile = vi.mocked(writeFile)
const mockedMkdir = vi.mocked(mkdir)

function makeSession(overrides: Partial<{ id: string; firstMessage: string; messageCount: number; created: Date }> = {}) {
  return {
    path: '/some/path.json',
    id: overrides.id ?? 'sess-1',
    cwd: '/some/dir',
    created: overrides.created ?? new Date('2025-01-15T10:00:00Z'),
    modified: new Date('2025-01-15T11:00:00Z'),
    messageCount: overrides.messageCount ?? 5,
    firstMessage: overrides.firstMessage ?? 'Hello world',
    allMessagesText: 'Hello world response',
  }
}

describe('ProjectManager', () => {
  let pm: ProjectManager

  beforeEach(() => {
    pm = new ProjectManager()
    vi.clearAllMocks()
    fsState.readData = ''
    fsState.readError = null
  })

  describe('workspace persistence', () => {
    it('restores projects and active session from workspace file', async () => {
      fsState.readData = JSON.stringify({
        projectPaths: ['/p/a', '/p/b'],
        activeSessionId: 'sess-1',
        activeProjectPath: '/p/a',
      })
      mockedList.mockResolvedValue([])

      await pm.loadWorkspace()

      const projects = pm.listProjects()
      expect(projects).toHaveLength(2)
      expect(projects.map((p) => p.path)).toEqual(['/p/a', '/p/b'])
      expect(pm.getActiveSession()).toEqual({ sessionId: 'sess-1', projectPath: '/p/a' })
      const [readPath, readEncoding] = mockedReadFile.mock.calls[0] as [string, string]
      expect(readEncoding).toBe('utf-8')
      expect(readPath.replaceAll('\\', '/')).toBe('/tmp/test-userdata/workspace.json')
    })

    it('ignores missing workspace file (ENOENT)', async () => {
      const err = new Error('missing') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      fsState.readError = err

      await expect(pm.loadWorkspace()).resolves.toBeUndefined()
      expect(pm.listProjects()).toEqual([])
    })

    it('handles corrupt workspace json safely', async () => {
      fsState.readData = '{not-json'

      await expect(pm.loadWorkspace()).resolves.toBeUndefined()
      expect(pm.listProjects()).toEqual([])
    })

    it('persists active session and project via setActiveSession', async () => {
      await pm.setActiveSession('s-active', '/p/active')

      expect(pm.getActiveSession()).toEqual({ sessionId: 's-active', projectPath: '/p/active' })
      const [mkdirPath, mkdirOpts] = mockedMkdir.mock.calls[0] as [string, { recursive: boolean }]
      expect(mkdirPath.replaceAll('\\', '/')).toBe('/tmp/test-userdata')
      expect(mkdirOpts).toEqual({ recursive: true })
      expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    })

    it('clears active session when removing active project', async () => {
      mockedList.mockResolvedValue([])
      const project = await pm.addProject('/active-project')
      await pm.setActiveSession('s-1', '/active-project')

      const removed = await pm.removeProject(project.id)
      expect(removed).toBe(true)
      expect(pm.getActiveSession()).toEqual({ sessionId: null, projectPath: null })
    })
  })

  describe('addProject', () => {
    it('normalizes path, discovers sessions, returns ProjectInfo', async () => {
      mockedList.mockResolvedValue([makeSession()])

      const result = await pm.addProject('/Users/dev/myproject')

      expect(result.id).toBe('project-1')
      expect(result.path).toBe('/Users/dev/myproject')
      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0]).toEqual({
        id: 'sess-1',
        firstMessage: 'Hello world',
        created: '2025-01-15T10:00:00.000Z',
        messageCount: 5,
      })
      expect(mockedList).toHaveBeenCalledWith('/Users/dev/myproject')
    })

    it('returns ProjectInfo with empty sessions when list() throws', async () => {
      mockedList.mockRejectedValue(new Error('ENOTDIR'))

      const result = await pm.addProject('/bad/path')

      expect(result.sessions).toEqual([])
      expect(result.path).toBe('/bad/path')
    })

    it('returns existing project for same path (case-insensitive)', async () => {
      mockedList.mockResolvedValue([makeSession()])
      await pm.addProject('/Users/dev/MyProject')

      // Second call with different case
      const result = await pm.addProject('/users/dev/myproject')

      expect(result.id).toBe('project-1')
      expect(mockedList).toHaveBeenCalledTimes(1)
    })

    it('assigns incrementing IDs', async () => {
      mockedList.mockResolvedValue([])

      const p1 = await pm.addProject('/path/a')
      const p2 = await pm.addProject('/path/b')

      expect(p1.id).toBe('project-1')
      expect(p2.id).toBe('project-2')
    })
  })

  describe('removeProject', () => {
    it('removes by id and returns true', async () => {
      mockedList.mockResolvedValue([])
      const added = await pm.addProject('/path/x')

      expect(await pm.removeProject(added.id)).toBe(true)
      expect(pm.listProjects()).toHaveLength(0)
    })

    it('returns false for non-existent id', async () => {
      expect(await pm.removeProject('no-such-id')).toBe(false)
    })
  })

  describe('listProjects', () => {
    it('returns all added projects', async () => {
      mockedList.mockResolvedValue([])
      await pm.addProject('/a')
      await pm.addProject('/b')

      const list = pm.listProjects()
      expect(list).toHaveLength(2)
      expect(list.map((p) => p.path)).toEqual(['/a', '/b'])
    })

    it('returns empty array when no projects', () => {
      expect(pm.listProjects()).toEqual([])
    })
  })

  describe('refreshSessions', () => {
    it('re-calls list and updates sessions', async () => {
      mockedList.mockResolvedValue([makeSession()])
      const project = await pm.addProject('/path')
      expect(project.sessions).toHaveLength(1)

      // Update mock to return different sessions
      mockedList.mockResolvedValue([
        makeSession({ id: 'sess-2', firstMessage: 'Updated', messageCount: 10 }),
      ])

      const refreshed = await pm.refreshSessions(project.id)
      expect(refreshed).not.toBeNull()
      expect(refreshed!.sessions).toHaveLength(1)
      expect(refreshed!.sessions[0].id).toBe('sess-2')
      expect(refreshed!.sessions[0].firstMessage).toBe('Updated')
    })

    it('returns null for non-existent project', async () => {
      const result = await pm.refreshSessions('nonexistent')
      expect(result).toBeNull()
    })

    it('handles discovery failure gracefully on refresh', async () => {
      mockedList.mockResolvedValue([makeSession()])
      const project = await pm.addProject('/path')

      mockedList.mockRejectedValue(new Error('boom'))
      const refreshed = await pm.refreshSessions(project.id)
      expect(refreshed!.sessions).toEqual([])
    })
  })

  describe('path normalization', () => {
    it('same folder different case returns same project', async () => {
      mockedList.mockResolvedValue([])
      const p1 = await pm.addProject('C:\\Users\\dev\\Project')
      const p2 = await pm.addProject('c:\\users\\dev\\project')

      expect(p1.id).toBe(p2.id)
      expect(pm.listProjects()).toHaveLength(1)
    })

    it('handles paths with trailing slashes', async () => {
      mockedList.mockResolvedValue([])
      const p1 = await pm.addProject('/path/project/')
      const p2 = await pm.addProject('/path/project')

      // Note: path normalization does NOT strip trailing slashes
      // These are treated as different paths
      expect(p1.id).not.toBe(p2.id)
      expect(pm.listProjects()).toHaveLength(2)
    })
  })
})
