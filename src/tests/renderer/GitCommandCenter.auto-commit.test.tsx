// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GitCommandCenter } from '@/renderer/src/components/git/GitCommandCenter'
import { AUTO_COMMIT_PROMPT } from '@/renderer/src/utils/auto-commit'

const { createSession, state, git } = vi.hoisted(() => ({
  createSession: vi.fn(),
  state: {
    activeProjectPath: '/project', activeSessionId: null as string | null, agentReady: true,
    projects: [] as Array<{ path: string; sessions: Array<{ id: string; firstMessage: string }> }>,
    sessionErrorMessages: {} as Record<string, string>,
    sessionStatuses: {} as Record<string, string>,
  },
  git: {
    isGitRepo: true as boolean | null, isStatusLoading: false,
    status: { staged: [] as string[], modified: [] as string[], untracked: [] as string[], conflicting: [] as string[], ahead: 0, behind: 0 },
    branches: [], log: { commits: [] }, error: null,
  },
}))

vi.mock('@/renderer/src/stores/project-store', () => ({ useProjectStore: () => ({ state, createSession }) }))
vi.mock('@/renderer/src/hooks/useGitOperations', () => ({ useGitOperations: () => git }))
vi.mock('@/renderer/src/components/git/BranchSelector', () => ({ BranchSelector: () => null }))
vi.mock('@/renderer/src/components/git/GitActions', () => ({ GitActions: () => null }))
vi.mock('@/renderer/src/components/git/StagingArea', () => ({ StagingArea: () => null }))
vi.mock('@/renderer/src/components/git/CommitInput', () => ({ CommitInput: () => null }))
vi.mock('@/renderer/src/components/git/DiffViewer', () => ({ DiffViewer: () => null }))
vi.mock('@/renderer/src/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

beforeEach(() => {
  vi.clearAllMocks()
  createSession.mockResolvedValue(undefined)
  state.activeProjectPath = '/project'
  state.activeSessionId = null
  state.agentReady = true
  state.projects = []
  state.sessionErrorMessages = {}
  state.sessionStatuses = {}
  git.isGitRepo = true
  git.isStatusLoading = false
  git.status.staged = []
  git.status.modified = ['changed.ts']
  git.status.untracked = []
  git.status.conflicting = []
})

describe('Git Auto commit', () => {
  it.each(['modified', 'untracked', 'staged'] as const)('starts a prompted session with only %s changes', async kind => {
    git.status.modified = []
    git.status[kind] = ['file.ts']
    render(<GitCommandCenter />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto commit' }))
    await waitFor(() => expect(createSession).toHaveBeenCalledWith('/project', AUTO_COMMIT_PROMPT))
  })

  it.each(['clean', 'conflicting', 'loading', 'connecting', 'unknown repository'] as const)('disables Auto commit for %s state', condition => {
    if (condition === 'clean') git.status.modified = []
    if (condition === 'conflicting') git.status.conflicting = ['conflict.ts']
    if (condition === 'loading') git.isStatusLoading = true
    if (condition === 'connecting') state.agentReady = false
    if (condition === 'unknown repository') git.isGitRepo = null
    render(<GitCommandCenter />)
    expect(screen.getByRole('button', { name: 'Auto commit' })).toBeDisabled()
  })

  it('prevents repeated clicks while session creation is pending', () => {
    createSession.mockReturnValue(new Promise(() => {}))
    render(<GitCommandCenter />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto commit' }))
    const button = screen.getByRole('button', { name: 'Starting session...' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(createSession).toHaveBeenCalledOnce()
  })

  it('shows creation errors and enables retry', async () => {
    createSession.mockRejectedValue(new Error('Provider unavailable'))
    render(<GitCommandCenter />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto commit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable')
    expect(screen.getByRole('button', { name: 'Auto commit' })).toBeEnabled()
  })

  it('shows persisted prompt errors when the modal is reopened', () => {
    state.activeSessionId = 'auto-session'
    state.projects = [{ path: '/project', sessions: [{ id: 'auto-session', firstMessage: AUTO_COMMIT_PROMPT.slice(0, 100) }] }]
    state.sessionErrorMessages = { 'auto-session': 'Prompt failed' }
    render(<GitCommandCenter />)
    expect(screen.getByRole('alert')).toHaveTextContent('Prompt failed')
  })

  it('prevents another Auto commit when the modal is reopened during a running session', () => {
    state.projects = [{ path: '/project', sessions: [{ id: 'auto-session', firstMessage: AUTO_COMMIT_PROMPT.slice(0, 100) }] }]
    state.sessionStatuses = { 'auto-session': 'streaming' }
    render(<GitCommandCenter />)
    expect(screen.getByRole('button', { name: 'Auto commit' })).toBeDisabled()
  })

  it('does not offer Auto commit without a project or repository', () => {
    git.isGitRepo = false
    const { rerender } = render(<GitCommandCenter />)
    expect(screen.queryByRole('button', { name: 'Auto commit' })).not.toBeInTheDocument()
    state.activeProjectPath = ''
    rerender(<GitCommandCenter />)
    expect(screen.queryByRole('button', { name: 'Auto commit' })).not.toBeInTheDocument()
  })
})
