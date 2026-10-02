// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GitCommandCenter } from '@/renderer/src/components/git/GitCommandCenter'

const { createSession, state, git } = vi.hoisted(() => ({
  createSession: vi.fn(),
  state: {
    activeProjectPath: '/project', activeSessionId: null as string | null, agentReady: true,
    projects: [] as Array<{ path: string; sessions: Array<{ id: string; firstMessage: string }> }>,
    sessionErrorMessages: {} as Record<string, string>, sessionStatuses: {} as Record<string, string>,
  },
  git: {
    isGitRepo: true as boolean | null, isStatusLoading: false,
    status: { staged: [] as string[], modified: ['changed.ts'], untracked: [] as string[], conflicting: [] as string[], ahead: 0, behind: 0 },
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
  Object.assign(state, { activeProjectPath: '/project', activeSessionId: null, agentReady: true, projects: [], sessionErrorMessages: {}, sessionStatuses: {} })
  Object.assign(git, { isGitRepo: true, isStatusLoading: false })
  git.status.staged = []; git.status.modified = ['changed.ts']; git.status.untracked = []; git.status.conflicting = []
})

describe('Git auto commit adversarial behavior', () => {
  it('does not treat an unrelated session whose title merely starts with the phrase as running', () => {
    state.projects = [{ path: '/project', sessions: [{ id: 'manual', firstMessage: 'Auto commitment notes' }] }]
    state.sessionStatuses = { manual: 'streaming' }
    render(<GitCommandCenter />)
    expect(screen.getByRole('button', { name: 'Auto commit' })).toBeEnabled()
  })

  it('clears the in-flight guard after a rejected start so a retry can be made', async () => {
    createSession.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(undefined)
    render(<GitCommandCenter />)
    const button = screen.getByRole('button', { name: 'Auto commit' })
    fireEvent.click(button)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Auto commit' }))
    expect(createSession).toHaveBeenCalledTimes(2)
  })

  it('ignores repeated clicks while session creation remains pending', async () => {
    const user = userEvent.setup()
    let resolveCreation!: () => void
    createSession.mockImplementation(() => new Promise<void>(resolve => { resolveCreation = resolve }))
    render(<GitCommandCenter />)
    const button = screen.getByRole('button', { name: 'Auto commit' })

    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Starting session...' }))
    await user.click(screen.getByRole('button', { name: 'Starting session...' }))
    expect(createSession).toHaveBeenCalledTimes(1)

    resolveCreation()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Auto commit' })).toBeEnabled())
  })
})
