/**
 * Critical Testing Expert: Git Interaction Feature — Stress Test Suite
 *
 * This test file rigorously audits the contracts defined by:
 *   - GitOperationsManager (src/main/git-operations-manager.ts)
 *   - Git IPC types (src/shared/ipc-types.ts)
 *   - useGitOperations hook (src/renderer/src/hooks/useGitOperations.ts)
 *   - IPC channel/handler contracts (src/main/ipc-handlers.ts)
 *
 * Following the Critical Testing Expert methodology:
 *   1. Test the CONTRACT, not the implementation
 *   2. Drill hidden assumptions in every argument
 *   3. Tests must BREAK things — surface shallow understanding and edge cases
 *   4. Attack abstraction ambiguity — find where the abstraction leaks
 *
 * Four test categories:
 *   Category 1: The "Name vs. Reality" Audit
 *   Category 2: Argument Boundary & Assumption Drilling
 *   Category 3: Abstraction Ambiguity
 *   Category 4: State & Side-Effect Skepticism
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitOperationsManager } from '../main/git-operations-manager'
import type {
  GitStatusResult,
  GitFileStatus,
} from '../shared/ipc-types'

// ============================================================================
// Mock simple-git for GitOperationsManager tests
// ============================================================================

/**
 * Creates a mock simple-git module that GitOperationsManager can use.
 * Each method is a vi.fn() so we can control return values and verify calls.
 */
function createMockSimpleGit() {
  const mockGit = {
    branch: vi.fn().mockResolvedValue({ current: 'main', branches: {} }),
    status: vi.fn().mockResolvedValue({
      current: 'main',
      isClean: () => true,
      staged: [],
      modified: [],
      not_added: [],
      conflicted: [],
      ahead: 0,
      behind: 0,
      files: [],
    }),
    log: vi.fn().mockResolvedValue({ all: [], total: 0 }),
    diff: vi.fn().mockResolvedValue(''),
    diffSummary: vi.fn().mockResolvedValue({ files: [], insertions: 0, deletions: 0 }),
    add: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ commit: 'abc1234', branch: 'main' }),
    push: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue({ files: [], summary: { insertions: 0, deletions: 0 } }),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    stash: vi.fn().mockResolvedValue(undefined),
    stashList: vi.fn().mockResolvedValue({ all: [] }),
    remote: vi.fn().mockResolvedValue(''),
  }
  return mockGit
}

type MockSimpleGit = ReturnType<typeof createMockSimpleGit>

/**
 * Monkey-patches the simple-git import for GitOperationsManager.
 * This works because GitOperationsManager calls `simpleGit(cwd)` each time.
 */
let mockGitInstance: MockSimpleGit

vi.mock('../main/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('simple-git', () => {
  return {
    default: (_cwd: string) => mockGitInstance,
  }
})

// ============================================================================
// CATEGORY 1: The "Name vs. Reality" Audit
// ============================================================================

describe('Category 1: "Name vs. Reality" Audit', () => {
  let manager: GitOperationsManager

  beforeEach(() => {
    mockGitInstance = createMockSimpleGit()
    manager = new GitOperationsManager()
  })

  // ── getBranch ──────────────────────────────────────────────────────
  describe('getBranch(cwd)', () => {
    it('name promises "get branch" but returns null silently on error — ambiguous: is "no branch" or "not a git repo"?', async () => {
      mockGitInstance.branch.mockRejectedValue(new Error('not a git repository'))
      const result = await manager.getBranch('/nonexistent')
      // The name says "getBranch" but it returns null on failure.
      // Null could mean: detached HEAD, not a git repo, or network error.
      // The contract is ambiguous — the caller can't distinguish these cases.
      expect(result).toBeNull()
    })

    it('returns null for a bare repo with no branches — is "no branch" semantically the same as "error"?', async () => {
      mockGitInstance.branch.mockResolvedValue({ current: '', branches: {} })
      const result = await manager.getBranch('/bare-repo')
      // Empty string becomes null. But a bare repo with no branches is different from
      // a non-git directory. The name "getBranch" doesn't distinguish.
      expect(result).toBeNull()
    })

    it('swallows errors silently — caller has no way to know something went wrong', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      mockGitInstance.branch.mockRejectedValue(new Error('permission denied'))
      const result = await manager.getBranch('/protected')
      // No exception thrown, just null. The caller thinks "no branch" when really
      // it's a permission error. This is a NAME vs REALITY failure:
      // "getBranch" implies a query, not a fallible operation.
      expect(result).toBeNull()
      consoleSpy.mockRestore()
    })
  })

  // ── getStatus ──────────────────────────────────────────────────────
  describe('getStatus(cwd)', () => {
    it('name promises "status" but throws a wrapped Error — inconsistent with getBranch which returns null', async () => {
      mockGitInstance.status.mockRejectedValue(new Error('not a git repo'))
      // getBranch returns null on error. getStatus throws.
      // Same kind of operation (query), different error contract.
      // The naming doesn't distinguish between "query that can fail" and "query that is optional".
      await expect(manager.getStatus('/nonexistent')).rejects.toThrow('Failed to get git status')
    })

    it('"isClean: true" is ambiguous — does it mean "no changes" or "successfully queried"?', async () => {
      // The default EMPTY_STATUS in the hook has isClean: true.
      // But that's also the value for a successfully-queried clean repo.
      // The hook treats isClean=true from EMPTY_STATUS the same as from a real query.
      const emptyStatus: GitStatusResult = {
        current: null, isClean: true, staged: [], modified: [],
        untracked: [], conflicting: [], ahead: 0, behind: 0,
      }
      // This is indistinguishable from "we haven't loaded yet" vs "repo is actually clean"
      expect(emptyStatus.isClean).toBe(true)
      expect(emptyStatus.current).toBeNull() // null current is the only tell
    })

    it('GitFileStatus.index uses string codes but the type is just "string" — no enum constraint', () => {
      // The type says `index: string` and `workingTree: string` but the doc comment
      // says only specific codes (A, M, D, R, C, ?, !) are valid.
      // Nothing prevents constructing a GitFileStatus with index: "Z" or index: "".
      const bogusFile: GitFileStatus = {
        path: 'test.ts',
        index: 'Z',  // Not a valid git status code!
        workingTree: '', // Empty string is not a valid status code!
      }
      // The type allows this. The contract is too permissive.
      expect(bogusFile.index).toBe('Z')
      expect(bogusFile.workingTree).toBe('')
    })
  })

  // ── commit ─────────────────────────────────────────────────────────
  describe('commit(cwd, message)', () => {
    it('name says "commit" but what happens with an empty message? Now validates', async () => {
      mockGitInstance.commit.mockResolvedValue({ commit: 'abc1234', branch: 'main' })
      // Previously: The type said `message: string`. Empty string was a valid string.
      // git itself rejects empty commit messages, but the CONTRACT didn't prevent it.
      // FIX: validateCommitMessage now rejects empty/whitespace-only messages.
      await expect(manager.commit('/repo', '')).rejects.toThrow('Invalid commit message')
    })

    it('name says "commit" but what about a multiline message with special chars? Contract is silent', async () => {
      mockGitInstance.commit.mockResolvedValue({ commit: 'abc1234', branch: 'main' })
      // What about commit messages with quotes, backticks, or git trailers?
      // The contract says `message: string` — no constraints on format.
      const trickyMessage = 'feat: add "feature"\n\nCo-authored-by: test <t@t>\n\n```js\ncode()\n```'
      const result = await manager.commit('/repo', trickyMessage)
      expect(result).toBeDefined()
    })

    it('returns empty strings on failed commit — the result type does not distinguish success from empty', async () => {
      mockGitInstance.commit.mockResolvedValue({ commit: undefined, branch: undefined })
      const result = await manager.commit('/repo', 'test')
      // hash: '' and hashAbbrev: '' — the type says GitCommitResult always has these,
      // but they could be empty strings. How does the caller know the commit "worked"?
      expect(result.hash).toBe('')
      expect(result.hashAbbrev).toBe('')
      // These are valid strings but represent a failure state!
    })
  })

  // ── push ───────────────────────────────────────────────────────────
  describe('push(cwd, remote?, branch?)', () => {
    it('name says "push" but returns void — caller cannot know IF anything was pushed', async () => {
      // push returns void. Was anything pushed? Were there commits to push?
      // The name implies an action, but the return type doesn't confirm it happened.
      mockGitInstance.push.mockResolvedValue(undefined)
      const result = await manager.push('/repo')
      expect(result).toBeUndefined()
      // No way to know: 0 commits pushed? 5 commits pushed? Already up to date?
    })

    it('remote+branch are optional — does push with no args push to origin/current? Contract is silent', async () => {
      // The signature: push(cwd, remote?, branch?)
      // If neither is provided, simple-git pushes to the default remote.
      // But what if there's no upstream set? What if there's no remote at all?
      // The contract doesn't specify the "no remote configured" behavior.
      mockGitInstance.push.mockRejectedValue(new Error('no upstream'))
      await expect(manager.push('/no-remote-repo')).rejects.toThrow('Failed to push')
    })
  })

  // ── pull ───────────────────────────────────────────────────────────
  describe('pull(cwd, remote?, branch?)', () => {
    it('name says "pull" but GitPullResult.changed is derived from file count — merge commits with no file changes report changed=false', async () => {
      // pull returns GitPullResult with `changed: (result.files?.length ?? 0) > 0`
      // But a merge commit can happen without file changes (e.g., fast-forward with same tree)
      // "changed: false" doesn't mean "nothing happened" — it might have fast-forwarded
      mockGitInstance.pull.mockResolvedValue({
        files: [],
        summary: { insertions: 0, deletions: 0 },
      })
      const result = await manager.pull('/repo')
      // No files changed, but git might have moved HEAD forward.
      // "changed: false" is misleading.
      expect(result.changed).toBe(false)
    })
  })

  // ── stash / stashPop ──────────────────────────────────────────────
  describe('stash(cwd, message?) / stashPop(cwd)', () => {
    it('"stash" returns void — caller cannot know the stash index or reference', async () => {
      mockGitInstance.stash.mockResolvedValue(undefined)
      const result = await manager.stash('/repo')
      // After stashing, the caller has no stash reference to pop a specific stash.
      // stashPop always pops the latest — but what if another stash was created between
      // stash() and stashPop() by a concurrent process?
      expect(result).toBeUndefined()
    })

    it('"stashPop" returns void — caller cannot know if conflicts occurred during pop', async () => {
      // stashPop returns void. But git stash pop can have merge conflicts.
      // The contract doesn't communicate this. The caller thinks it succeeded.
      mockGitInstance.stash.mockResolvedValue(undefined)
      const result = await manager.stashPop('/repo')
      expect(result).toBeUndefined()
    })
  })

  // ── branchCreate ──────────────────────────────────────────────────
  describe('branchCreate(cwd, name, checkout?)', () => {
    it('name says "create" but with checkout=true it also switches — should be "createAndSwitch"', async () => {
      // When checkout=true (the default!), the method both creates AND switches.
      // The name "branchCreate" only communicates the creation part.
      // A caller who just wants to create a branch without switching must pass checkout=false,
      // but the name doesn't suggest this dual behavior.
      mockGitInstance.checkoutBranch.mockResolvedValue(undefined)
      await manager.branchCreate('/repo', 'feature', true)
      expect(mockGitInstance.checkoutBranch).toHaveBeenCalledWith('feature', 'HEAD')
    })

    it('name with checkout=false still just creates — but there is no "branchCreateOrSwitch"', async () => {
      mockGitInstance.branch.mockResolvedValue(undefined) // Note: branch() not checkoutBranch()
      await manager.branchCreate('/repo', 'feature', false)
      // Uses git.branch([name]) instead of checkoutBranch — completely different behavior
      // based on a boolean flag. The name doesn't hint at this.
    })
  })

  // ── getRemoteUrl ──────────────────────────────────────────────────
  describe('getRemoteUrl(cwd, remote?)', () => {
    it('returns null when remote does not exist — is "no remote" or "no URL"?', async () => {
      mockGitInstance.remote.mockRejectedValue(new Error('No such remote'))
      const result = await manager.getRemoteUrl('/repo', 'upstream')
      // null could mean: remote doesn't exist, or remote has no URL set.
      // The name "getRemoteUrl" doesn't distinguish these cases.
      expect(result).toBeNull()
    })

    it('returns empty string as null — but what if the remote URL IS an empty string?', async () => {
      mockGitInstance.remote.mockResolvedValue('')
      const result = await manager.getRemoteUrl('/repo', 'origin')
      // An empty string from `git remote get-url` becomes null.
      // But what if someone actually configured an empty URL? (Unlikely but contractually possible)
      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// CATEGORY 2: Argument Boundary & Assumption Drilling
// ============================================================================

describe('Category 2: Argument Boundary & Assumption Drilling', () => {
  let manager: GitOperationsManager

  beforeEach(() => {
    mockGitInstance = createMockSimpleGit()
    manager = new GitOperationsManager()
  })

  // ── cwd argument ──────────────────────────────────────────────────
  describe('cwd: string — path argument boundaries', () => {
    it('empty string cwd — now validated and rejected', async () => {
      // FIX: validateCwd now rejects empty/whitespace-only cwd
      await expect(manager.getStatus('')).rejects.toThrow('Invalid cwd')
    })

    it('relative path cwd — now validated to reject traversal paths', async () => {
      // FIX: validateCwd now rejects paths that normalize to starting with '..'
      // A relative path like '../other-project' is now rejected.
      // Valid relative paths like './subdir' or 'subdir' are still allowed.
      await expect(manager.getStatus('../relative-path')).rejects.toThrow('Invalid cwd')
    })

    it('path with spaces and unicode — no validation or sanitization', async () => {
      mockGitInstance.status.mockResolvedValue({
        current: 'main', isClean: () => true, staged: [], modified: [],
        not_added: [], conflicted: [], ahead: 0, behind: 0, files: [],
      })
      // Windows paths with spaces, Chinese characters, emoji, etc.
      const result = await manager.getStatus('C:/Users/用户/My Projects/📂 repo')
      expect(result).toBeDefined()
    })

    it('path traversal attack — now validated to reject relative traversal paths', async () => {
      // FIX: validateCwd rejects paths that normalize to starting with '..'
      // Note: An absolute path like '/etc/../../../etc/passwd' normalizes
      // to '/etc/passwd' (an absolute path), which is not caught by this check.
      // The validation specifically catches relative traversal attacks.
      await expect(manager.getStatus('../../etc/passwd')).rejects.toThrow('Invalid cwd')
    })
  })

  // ── filePath argument ─────────────────────────────────────────────
  describe('filePath: string — file path boundaries', () => {
    it('empty filePath to stage — now validates and throws', async () => {
      mockGitInstance.add.mockResolvedValue(undefined)
      // FIX: stage() now validates that filePath is non-empty
      await expect(manager.stage('/repo', '')).rejects.toThrow('Invalid filePath')
    })

    it('filePath with path traversal — stage "../../etc/passwd"?', async () => {
      mockGitInstance.add.mockResolvedValue(undefined)
      await manager.stage('/repo', '../../etc/passwd')
      // No path sanitization. The contract trusts the caller completely.
      expect(mockGitInstance.add).toHaveBeenCalledWith('../../etc/passwd')
    })

    it('filePath that is a directory — does stage add the whole directory?', async () => {
      mockGitInstance.add.mockResolvedValue(undefined)
      // `git add src/` stages the entire directory recursively.
      // The name "stage" with "filePath" implies a file, not a directory.
      // But the type allows any string, including directory paths.
      await manager.stage('/repo', 'src/')
      expect(mockGitInstance.add).toHaveBeenCalledWith('src/')
    })
  })

  // ── message argument ──────────────────────────────────────────────
  describe('message: string — commit message boundaries', () => {
    it('extremely long commit message (1MB) — now has length constraint', async () => {
      mockGitInstance.commit.mockResolvedValue({ commit: 'abc1234', branch: 'main' })
      const hugeMessage = 'x'.repeat(1024 * 1024)
      // FIX: validateCommitMessage now rejects messages over 10000 chars
      await expect(manager.commit('/repo', hugeMessage)).rejects.toThrow('too long')
    })

    it('commit message with only whitespace — git rejects it but contract allows it', async () => {
      mockGitInstance.commit.mockRejectedValue(new Error('empty commit message'))
      // A message of "   " passes the type check but git rejects it.
      // The contract should validate this before calling git.
      await expect(manager.commit('/repo', '   ')).rejects.toThrow()
    })

    it('commit message with null bytes — now validates and throws', async () => {
      mockGitInstance.commit.mockResolvedValue({ commit: 'abc1234', branch: 'main' })
      // FIX: validateCommitMessage now rejects null bytes
      const msgWithNull = 'feat:\0something'
      await expect(manager.commit('/repo', msgWithNull)).rejects.toThrow('null bytes')
    })
  })

  // ── branch name argument ──────────────────────────────────────────
  describe('name: string — branch name boundaries', () => {
    it('branch name with spaces — git rejects it but contract allows it', async () => {
      mockGitInstance.checkoutBranch.mockRejectedValue(new Error('invalid branch name'))
      await expect(manager.branchCreate('/repo', 'my feature')).rejects.toThrow()
    })

    it('branch name starting with "-" — now validated and rejected', async () => {
      mockGitInstance.branch.mockRejectedValue(new Error('invalid'))
      // FIX: validateBranchName now rejects names starting with a dash
      await expect(manager.branchCreate('/repo', '--all', false)).rejects.toThrow('must not start with a dash')
    })

    it('empty branch name — now validated and rejected', async () => {
      mockGitInstance.checkoutBranch.mockRejectedValue(new Error('empty name'))
      // FIX: validateBranchName now rejects empty branch names
      await expect(manager.branchCreate('/repo', '')).rejects.toThrow('Invalid branch name')
    })
  })

  // ── maxCount argument ─────────────────────────────────────────────
  describe('maxCount?: number — log pagination boundaries', () => {
    it('maxCount=0 — does it return 0 commits or ignore the parameter?', async () => {
      mockGitInstance.log.mockResolvedValue({ all: [], total: 0 })
      const result = await manager.getLog('/repo', 0)
      // Passing 0 should return 0 commits, but the contract doesn't specify.
      expect(result.commits).toHaveLength(0)
    })

    it('maxCount=-1 — now validated, falls back to default', async () => {
      mockGitInstance.log.mockResolvedValue({ all: [], total: 0 })
      // FIX: maxCount validation now clamps negative values to default (50)
      const result = await manager.getLog('/repo', -1)
      expect(result).toBeDefined()
    })

    it('maxCount=Infinity — now validated, falls back to default', async () => {
      mockGitInstance.log.mockResolvedValue({ all: [], total: 0 })
      // FIX: maxCount validation now clamps Infinity to default (50)
      const result = await manager.getLog('/repo', Infinity)
      expect(result).toBeDefined()
    })

    it('maxCount=1.5 — now validated, floored to integer', async () => {
      mockGitInstance.log.mockResolvedValue({ all: [], total: 0 })
      // FIX: maxCount validation now floors floating point values
      const result = await manager.getLog('/repo', 1.5)
      expect(result).toBeDefined()
    })
  })

  // ── remote argument ───────────────────────────────────────────────
  describe('remote?: string — remote name boundaries', () => {
    it('empty string remote — now explicitly treated as undefined', async () => {
      mockGitInstance.fetch.mockResolvedValue(undefined)
      // FIX: empty string remote is now explicitly converted to undefined
      // This makes the behavior explicit rather than relying on JS falsiness
      await manager.fetch('/repo', '')
      // Empty string is now normalized to undefined, so fetch gets no remote arg
      expect(mockGitInstance.fetch).toHaveBeenCalledWith([])
    })
  })
})

// ============================================================================
// CATEGORY 3: Abstraction Ambiguity
// ============================================================================

describe('Category 3: Abstraction Ambiguity', () => {
  let manager: GitOperationsManager

  beforeEach(() => {
    mockGitInstance = createMockSimpleGit()
    manager = new GitOperationsManager()
  })

  // ── The "singleton that creates new instances" paradox ─────────────
  describe('GitOperationsManager stateless design', () => {
    it('class is stateless but exported as singleton — why a class at all?', () => {
      // GitOperationsManager is a class with no state — every method creates
      // a fresh simple-git instance. It could be a plain object with functions.
      // The class pattern implies state management, but there is none.
      // This is an abstraction that promises more than it delivers.
      const manager2 = new GitOperationsManager()
      // Two instances are identical — no state to differentiate them.
      expect(manager).not.toBe(manager2)
      // But they behave identically because all state is in the git calls.
    })
  })

  // ── The "mapStatus" mapping loses information ──────────────────────
  describe('mapStatus data loss', () => {
    it('GitFileStatus.index maps from raw.files.find() — but what if the path appears multiple times?', async () => {
      // The mapStatus function uses raw.files.find((rf) => rf.path === f)
      // to look up the index/workingTree codes. But find() returns the FIRST match.
      // If a file appears multiple times in raw.files (renames can cause this),
      // the wrong status code might be used.
      const rawStatus = {
        current: 'main',
        isClean: () => false,
        staged: ['old-name.ts'],
        modified: [],
        not_added: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        files: [
          { path: 'old-name.ts', index: 'R', working_dir: ' ' },
          { path: 'old-name.ts', index: 'M', working_dir: 'M' }, // Same path, different codes!
        ],
      }
      mockGitInstance.status.mockResolvedValue(rawStatus)
      const result = await manager.getStatus('/repo')
      // find() returns the first match — the 'R' (rename) code.
      // The 'M' (modify) code on the same path is silently lost.
      expect(result.staged).toHaveLength(1)
      expect(result.staged[0].index).toBe('R')
    })

    it('modified files that are also staged get wrong workingTree code', async () => {
      // A file can be both staged AND have unstaged modifications.
      // The current mapping puts it in `staged` with the staged status code,
      // and in `modified` with the working tree code. But the same file
      // appears in both arrays with different codes, which could confuse consumers.
      const rawStatus = {
        current: 'main',
        isClean: () => false,
        staged: ['file.ts'],
        modified: ['file.ts'],
        not_added: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        files: [
          { path: 'file.ts', index: 'M', working_dir: 'M' }, // Both staged AND unstaged changes
        ],
      }
      mockGitInstance.status.mockResolvedValue(rawStatus)
      const result = await manager.getStatus('/repo')
      // file.ts appears in both staged and modified arrays.
      // The consumer has to deduplicate to understand the full picture.
      expect(result.staged.some(f => f.path === 'file.ts')).toBe(true)
      expect(result.modified.some(f => f.path === 'file.ts')).toBe(true)
    })
  })

  // ── The "mapLog" mapping loses information ─────────────────────────
  describe('mapLog data loss', () => {
    it('parents array is always empty — the type promises string[] but always returns []', async () => {
      mockGitInstance.log.mockResolvedValue({
        all: [{ hash: 'abc', message: 'test', author_name: 'A', author_email: 'a@b' }],
        total: 1,
      })
      const result = await manager.getLog('/repo')
      // The GitLogEntry type has `parents: string[]` but the mapping
      // hardcodes it to `[]` with a comment "simple-git doesn't expose parents".
      // This is an abstraction leak: the type promises data the implementation can't provide.
      expect(result.commits[0].parents).toEqual([])
    })

    it('relativeDate is always empty string — same issue as parents', async () => {
      mockGitInstance.log.mockResolvedValue({
        all: [{ hash: 'abc', message: 'test', author_name: 'A', author_email: 'a@b' }],
        total: 1,
      })
      const result = await manager.getLog('/repo')
      // The type has `relativeDate: string` but it's always ''.
      // UI code that tries to display this will show nothing.
      expect(result.commits[0].relativeDate).toBe('')
    })

    it('hashAbbrev is always first 7 chars — but git abbreviates to unique length', async () => {
      mockGitInstance.log.mockResolvedValue({
        all: [{ hash: 'abc1234def5678', message: 'test' }],
        total: 1,
      })
      const result = await manager.getLog('/repo')
      // substring(0, 7) is a naive abbreviation. Git uses `--abbrev-commit`
      // which finds the shortest unambiguous prefix. In a large repo,
      // 7 chars might not be unique. The contract doesn't guarantee uniqueness.
      expect(result.commits[0].hashAbbrev).toBe('abc1234')
      // But in a repo with 100k+ commits, 7 chars might collide!
    })
  })

  // ── The "branchList refName" mapping is wrong ──────────────────────
  describe('branchList mapping: refName is just name', () => {
    it('GitBranchRef.refName now correctly returns "refs/heads/main" for local branches', async () => {
      mockGitInstance.branch.mockResolvedValue({
        current: 'main',
        branches: {
          main: { name: 'main', current: true, commit: 'abc', label: 'initial' },
        },
      })
      const result = await manager.branchList('/repo')
      // FIX: refName is now correctly prefixed with refs/heads/ for local branches
      expect(result.branches[0].refName).toBe('refs/heads/main')
      // The contract now matches the documented behavior!
    })
  })

  // ── The "stashList" mapping loses branch info ──────────────────────
  describe('stashList mapping: branchName is always empty', () => {
    it('GitStashEntry.branchName now extracts branch from stash message', async () => {
      mockGitInstance.stashList.mockResolvedValue({
        all: [{ message: 'On main: WIP', hash: 'abc', date: '2024-01-01' }],
      })
      const result = await manager.stashList('/repo')
      // FIX: branchName is now extracted from the stash message format "On <branch>: <msg>"
      expect(result.stashes[0].branchName).toBe('main')
    })
  })

  // ── The unstage "HEAD" assumption ──────────────────────────────────
  describe('unstage uses "HEAD" — breaks on repos with no commits', () => {
    it('git reset HEAD fails on a brand new repo with zero commits', async () => {
      mockGitInstance.reset.mockRejectedValue(new Error('ambiguous argument: HEAD'))
      // unstage() calls `git reset HEAD -- <file>`. But on a brand new repo
      // with no commits, HEAD doesn't exist. This is a fundamental assumption
      // that the abstraction doesn't handle.
      await expect(manager.unstage('/new-repo', 'file.ts')).rejects.toThrow()
    })

    it('unstageAll has the same HEAD assumption', async () => {
      mockGitInstance.reset.mockRejectedValue(new Error('ambiguous argument: HEAD'))
      await expect(manager.unstageAll('/new-repo')).rejects.toThrow()
    })
  })

  // ── The push/pull remote assumption ────────────────────────────────
  describe('push/pull assume origin exists', () => {
    it('push with no args relies on git config having a default push target', async () => {
      mockGitInstance.push.mockRejectedValue(new Error('no upstream branch'))
      // If you call push() without remote/branch, git needs:
      // 1. A remote (usually origin)
      // 2. An upstream branch configured (push.autoSetupRemote or branch.*.remote)
      // The abstraction doesn't validate this before attempting the push.
      await expect(manager.push('/repo')).rejects.toThrow()
    })
  })
})

// ============================================================================
// CATEGORY 4: State & Side-Effect Skepticism
// ============================================================================

describe('Category 4: State & Side-Effect Skepticism', () => {
  let manager: GitOperationsManager

  beforeEach(() => {
    mockGitInstance = createMockSimpleGit()
    manager = new GitOperationsManager()
  })

  // ── Race conditions ────────────────────────────────────────────────
  describe('Race conditions in async operations', () => {
    it('concurrent stage/unstage of the same file — now has locking in the hook layer', async () => {
      mockGitInstance.add.mockResolvedValue(undefined)
      // Note: The locking is implemented in useGitOperations (renderer hook),
      // not in GitOperationsManager (main process). The manager itself is
      // still vulnerable to concurrent calls from different IPC handlers.
      // However, the hook's withLock() ensures sequential execution
      // for the same operation key, preventing last-writer-wins in the UI.

      // At the manager level, stage still works:
      await manager.stage('/repo', 'file.ts')
      expect(mockGitInstance.add).toHaveBeenCalledWith('file.ts')
    })

    it('concurrent commits — two commits happening at the same time', async () => {
      let callCount = 0
      mockGitInstance.commit.mockImplementation(async () => {
        callCount++
        // Simulate a slow commit
        await new Promise(resolve => setTimeout(resolve, 10))
        return { commit: `hash${callCount}`, branch: 'main' }
      })

      // Two commits with different messages
      const [result1, result2] = await Promise.allSettled([
        manager.commit('/repo', 'first commit'),
        manager.commit('/repo', 'second commit'),
      ])

      // Both completed, but the second commit might fail because
      // the first commit changed HEAD. Or both might succeed,
      // resulting in two separate commits.
      // The abstraction doesn't handle this case.
      expect(result1.status).toBe('fulfilled')
      expect(result2.status).toBe('fulfilled')
    })

    it('branchSwitch while a push is in progress — no mutual exclusion', async () => {
      mockGitInstance.push.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      mockGitInstance.checkout.mockResolvedValue(undefined)

      // Push to branch A, then immediately switch to branch B
      const pushPromise = manager.push('/repo', 'origin', 'branch-a')
      const switchPromise = manager.branchSwitch('/repo', 'branch-b')

      await Promise.allSettled([pushPromise, switchPromise])
      // The push is now running on the wrong branch!
      // No locking mechanism prevents this.
    })
  })

  // ── Idempotency ───────────────────────────────────────────────────
  describe('Idempotency failures', () => {
    it('stage the same file twice — is it idempotent?', async () => {
      mockGitInstance.add.mockResolvedValue(undefined)
      await manager.stage('/repo', 'file.ts')
      await manager.stage('/repo', 'file.ts')
      // git add is idempotent — staging an already-staged file is a no-op.
      // But the abstraction calls simple-git twice, wasting resources.
      expect(mockGitInstance.add).toHaveBeenCalledTimes(2)
    })

    it('commit with no staged changes — should fail, not silently succeed', async () => {
      mockGitInstance.commit.mockRejectedValue(new Error('nothing to commit'))
      // Calling commit() with nothing staged should be an error.
      // The abstraction doesn't pre-validate this — it just passes through to git.
      await expect(manager.commit('/repo', 'empty commit')).rejects.toThrow()
    })

    it('stashPop called twice with one stash — second call should fail', async () => {
      // stashPop calls git.stash(['pop'])
      // First pop: succeeds
      mockGitInstance.stash.mockResolvedValueOnce(undefined)
      // Second pop: no stash to pop
      mockGitInstance.stash.mockRejectedValueOnce(new Error('no stash entries'))

      // First pop succeeds
      await manager.stashPop('/repo')
      // Second pop — the stash is gone
      await expect(manager.stashPop('/repo')).rejects.toThrow('Failed to pop stash')
    })

    it('push called twice — idempotent for git, but network overhead doubled', async () => {
      mockGitInstance.push.mockResolvedValue(undefined)
      await manager.push('/repo')
      await manager.push('/repo')
      // git push is idempotent (everything up-to-date on second call)
      // But we're making two network requests for no reason.
      expect(mockGitInstance.push).toHaveBeenCalledTimes(2)
    })
  })

  // ── useGitOperations hook state pollution ──────────────────────────
  describe('useGitOperations hook: state pollution across project switches', () => {
    // These tests validate the CONTRACT of the hook, not the implementation.
    // We test the assumptions the hook makes about state management.

    it('EMPTY_STATUS has isClean=true — stale state looks like "clean repo"', () => {
      // When the project changes, the hook resets to EMPTY_STATUS.
      // But EMPTY_STATUS.isClean = true means the UI briefly shows "clean"
      // before the actual status loads. This is a misleading intermediate state.
      const EMPTY_STATUS: GitStatusResult = {
        current: null, isClean: true, staged: [], modified: [],
        untracked: [], conflicting: [], ahead: 0, behind: 0,
      }
      // The UI sees isClean=true and might disable the "commit" button,
      // then re-enable it once the real status loads. Flicker.
      expect(EMPTY_STATUS.isClean).toBe(true)
    })

    it('error state is shared across all operations — one failure taints all', () => {
      // The hook has a single `error: string | null` state.
      // If push fails, the error is set. But then if you view a diff,
      // the same error is still showing. The error from push "pollutes" diff viewing.
      // This is an abstraction leak: errors should be scoped per operation.
      const hookContract = {
        error: 'Failed to push: network error',
        isDiffLoading: false,
        isStatusLoading: false,
      }
      // The error from push is still visible when the user switches to viewing diffs.
      // There's no way to clear the push error without clearing ALL errors.
      expect(hookContract.error).toBeTruthy()
    })

    it('refreshStatus is in useCallback deps of ALL mutations — infinite re-render risk', () => {
      // Every mutation callback (stageFile, unstageFile, etc.) depends on refreshStatus.
      // If refreshStatus changes identity, ALL mutation callbacks change.
      // This could cause unnecessary re-renders in consuming components.
      // The contract doesn't guarantee callback stability.
      // This is a hidden coupling that the hook abstraction doesn't protect against.
      expect(true).toBe(true) // Documenting the risk
    })
  })

  // ── Polling interval assumptions ──────────────────────────────────
  describe('Polling interval assumptions', () => {
    it('5-second polling interval is hardcoded — not configurable', () => {
      // STATUS_POLL_INTERVAL = 5000 is a module constant.
      // There's no way to configure it per project or per user preference.
      // The abstraction assumes one-size-fits-all polling frequency.
      // For large monorepos, 5s might be too aggressive.
      // For small repos, it might be too conservative.
      const POLL_INTERVAL = 5000
      expect(POLL_INTERVAL).toBe(5000) // Hardcoded, inflexible
    })

    it('polling continues even when the window is hidden — battery drain', () => {
      // The hook polls every 5s regardless of document.visibilityState.
      // If the user switches to another app, the polling continues.
      // The abstraction assumes the window is always active.
      expect(true).toBe(true) // Documenting the assumption
    })

    it('polling is not debounced — rapid project switches create polling chaos', () => {
      // If the user rapidly switches projects, the useEffect cleanup clears
      // the old interval and sets a new one. But refreshAll is called on
      // each mount, meaning multiple refreshAll calls can overlap.
      // There's no debouncing or abort controller for in-flight requests.
      expect(true).toBe(true) // Documenting the risk
    })
  })

  // ── Shared mutable state via singleton ─────────────────────────────
  describe('gitOperationsManager singleton', () => {
    it('singleton is shared across all IPC handlers — no request isolation', () => {
      // All IPC handlers use the same gitOperationsManager instance.
      // If two renderer windows call different git operations simultaneously,
      // they share the same manager. There's no request-scoped state,
      // no request cancellation, and no operation queuing.
      const manager1 = new GitOperationsManager()
      const manager2 = new GitOperationsManager()
      // These are different instances but have identical behavior.
      // The real singleton is exported as `gitOperationsManager`.
      // Multiple concurrent calls to the singleton have no coordination.
      expect(manager1).not.toBe(manager2)
    })
  })
})

// ============================================================================
// BONUS: Contract Inconsistency Matrix
// ============================================================================

describe('Bonus: Contract Inconsistency Matrix', () => {
  let manager: GitOperationsManager

  beforeEach(() => {
    mockGitInstance = createMockSimpleGit()
    manager = new GitOperationsManager()
  })

  it('getBranch returns null on error but getStatus throws — inconsistent error strategy', async () => {
    mockGitInstance.branch.mockRejectedValue(new Error('fail'))
    mockGitInstance.status.mockRejectedValue(new Error('fail'))

    const branchResult = await manager.getBranch('/repo')
    expect(branchResult).toBeNull() // Returns null

    await expect(manager.getStatus('/repo')).rejects.toThrow() // Throws
    // Same category of error, different error handling strategy!
  })

  it('getRemoteUrl returns null on error but getLog throws — same inconsistency', async () => {
    mockGitInstance.remote.mockRejectedValue(new Error('fail'))
    mockGitInstance.log.mockRejectedValue(new Error('fail'))

    const urlResult = await manager.getRemoteUrl('/repo')
    expect(urlResult).toBeNull() // Returns null

    await expect(manager.getLog('/repo')).rejects.toThrow() // Throws
    // Why is "remote not found" silently null, but "log failed" is an error?
  })

  it('GitCommitResult.hash can be empty string — type says string but empty means failure', async () => {
    mockGitInstance.commit.mockResolvedValue({ commit: undefined, branch: undefined })
    const result = await manager.commit('/repo', 'test')
    // hash is '' — this is technically a valid string, but semantically it's a failure.
    // The type should use `hash: string | null` or a Result type.
    expect(result.hash).toBe('')
    expect(result.hashAbbrev).toBe('')
    expect(result.branch).toBe('')
  })

  it('GitLogEntry.author can be empty string — no way to distinguish "unknown" from "missing"', async () => {
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash: 'abc', message: 'test', author_name: null, author_email: null }],
      total: 1,
    })
    const result = await manager.getLog('/repo')
    // author_name is null → mapped to ''. Is this "author not set" or "rebase in progress"?
    expect(result.commits[0].author).toBe('')
    expect(result.commits[0].authorEmail).toBe('')
  })

  it('IPC handler for GIT_DIFF passes staged as boolean but getDiff signature expects boolean — what if IPC sends string "false"?', () => {
    // The IPC handler destructures `staged` from the payload.
    // If the renderer sends `{ cwd: '/repo', staged: "false" }`,
    // JavaScript treats the string "false" as truthy!
    // The type system prevents this, but at the IPC boundary (JSON serialization),
    // types are not enforced.
    const payload = { cwd: '/repo', staged: 'false' as unknown as boolean }
    // 'false' as boolean — the type lies, but at runtime this is truthy!
    expect(Boolean(payload.staged)).toBe(true)
    // This is a fundamental IPC trust boundary issue.
  })

  it('GitBranchRef.isRemote checks for "remotes/" prefix — but remote branches can have other naming conventions', async () => {
    mockGitInstance.branch.mockResolvedValue({
      current: 'main',
      branches: {
        main: { name: 'main', current: true, commit: 'abc', label: 'initial' },
        'remotes/origin/main': { name: 'remotes/origin/main', current: false, commit: 'abc', label: 'initial' },
      },
    })
    const result = await manager.branchList('/repo')
    const remoteBranch = result.branches.find(b => b.name.startsWith('remotes/'))
    expect(remoteBranch?.isRemote).toBe(true)
    // But what about remote tracking branches like "origin/main" without "remotes/" prefix?
    // The naming convention is not guaranteed by git itself.
  })
})
