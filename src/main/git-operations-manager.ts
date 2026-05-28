/**
 * GitOperationsManager — Wraps simple-git to provide all Git operations
 * for the NekoCode Git Command Center.
 *
 * All methods take a `cwd` parameter so they can operate on any open project.
 * Errors are caught and re-thrown with user-friendly messages.
 */

import simpleGit, { type SimpleGit, type StatusResult, type LogResult, type BranchSummary } from 'simple-git'
import { createLogger } from './logger'
import * as path from 'path'

const logger = createLogger('git-ops')

// ━━ Input validation helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Validate that cwd is a non-empty string that looks like a valid path */
function validateCwd(cwd: string): void {
  if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
    throw new Error('Invalid cwd: working directory path must be a non-empty string')
  }
  // Reject path traversal that escapes upward beyond a reasonable root
  // (e.g., "../../etc/passwd") — a valid project path should not be purely traversal
  const normalized = path.normalize(cwd)
  if (normalized.startsWith('..')) {
    throw new Error('Invalid cwd: path must not be a relative traversal (starts with ..)')
  }
}

/** Validate that a branch name is not empty and doesn't look like a git flag */
function validateBranchName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('Invalid branch name: must be a non-empty string')
  }
  if (name.startsWith('-')) {
    throw new Error('Invalid branch name: must not start with a dash (would be interpreted as a git flag)')
  }
}

/** Validate that a commit message is non-empty and within reasonable length */
function validateCommitMessage(message: string): void {
  if (!message || typeof message !== 'string' || message.trim() === '') {
    throw new Error('Invalid commit message: must be a non-empty string')
  }
  if (message.length > 10000) {
    throw new Error(`Invalid commit message: too long (${message.length} chars, max 10000)`)
  }
  // Reject null bytes which can corrupt git internals
  if (message.includes('\0')) {
    throw new Error('Invalid commit message: must not contain null bytes')
  }
  // Security: simple-git uses child_process.spawn (not shell execution), so shell
  // metacharacters like backticks, $(), and backslashes are NOT exploitable here.
  // Previously we rejected these as defense-in-depth, but that was too aggressive —
  // legitimate commit messages frequently contain backticks (e.g., Markdown code,
  // Git trailers with references). The null byte check above is sufficient since
  // spawn arguments are passed as an array, not interpolated into a shell command.
}

import type {
  GitStatusResult,
  GitFileStatus,
  GitLogResult,
  GitLogEntry,
  GitDiffResult,
  GitDiffSummaryResult,
  GitDiffSummaryEntry,
  GitCommitResult,
  GitBranchRef,
  GitBranchListResult,
  GitPullResult,
  GitStashEntry,
  GitStashListResult,
} from '../shared/ipc-types'

/** Create a SimpleGit instance for the given working directory */
function git(cwd: string): SimpleGit {
  return simpleGit(cwd)
}

/** Map a simple-git StatusResult to our GitStatusResult type */
function mapStatus(raw: StatusResult): GitStatusResult {
  // Build a map of path -> raw file entry for efficient lookup
  // Important: if the same path appears multiple times (e.g., staged AND modified),
  // we need to find ALL matches, not just the first
  const fileMap = new Map<string, typeof raw.files[number][]>()
  for (const rf of raw.files) {
    const existing = fileMap.get(rf.path) ?? []
    existing.push(rf)
    fileMap.set(rf.path, existing)
  }

  /** Find the best raw file entry for a path, preferring the one matching the given status type */
  const findFile = (filePath: string, preferIndex?: string, preferWorkDir?: string) => {
    const entries = fileMap.get(filePath) ?? []
    if (entries.length === 0) return { index: '?' as string, working_dir: ' ' as string }
    // If multiple entries, prefer the one matching our desired status
    if (entries.length > 1) {
      const preferred = entries.find((e) =>
        (preferIndex && e.index === preferIndex) ||
        (preferWorkDir && e.working_dir === preferWorkDir)
      )
      if (preferred) return preferred
    }
    return entries[0]
  }

  const staged: GitFileStatus[] = raw.staged.map((f) => {
    const rf = findFile(f, undefined, undefined)
    return {
      path: f,
      index: rf?.index ?? '?',
      workingTree: rf?.working_dir ?? ' ',
    }
  })

  const modified: GitFileStatus[] = raw.modified.map((f) => {
    const rf = findFile(f, undefined, 'M')
    return {
      path: f,
      index: rf?.index ?? ' ',
      workingTree: rf?.working_dir ?? 'M',
    }
  })

  const untracked: GitFileStatus[] = raw.not_added.map((f) => ({
    path: f,
    index: '?',
    workingTree: '?',
  }))

  // Files with conflicts have both index and working_tree marked
  const conflicting: GitFileStatus[] = raw.conflicted.map((f) => {
    const rf = findFile(f, 'U', 'U')
    return {
      path: f,
      index: rf?.index ?? 'U',
      workingTree: rf?.working_dir ?? 'U',
    }
  })

  return {
    current: raw.current,
    isClean: raw.isClean(),
    staged,
    modified,
    untracked,
    conflicting,
    ahead: raw.ahead ?? 0,
    behind: raw.behind ?? 0,
  }
}

/** Compute a relative date string from an ISO date string */
function toRelativeDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    const diffWeek = Math.floor(diffDay / 7)
    const diffMonth = Math.floor(diffDay / 30)
    const diffYear = Math.floor(diffDay / 365)

    if (diffSec < 60) return 'just now'
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`
    if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`
    if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`
    if (diffWeek < 5) return `${diffWeek} week${diffWeek !== 1 ? 's' : ''} ago`
    if (diffMonth < 12) return `${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`
    return `${diffYear} year${diffYear !== 1 ? 's' : ''} ago`
  } catch {
    return ''
  }
}

/** Map a simple-git LogResult to our GitLogResult type */
function mapLog(raw: LogResult): GitLogResult {
  const commits: GitLogEntry[] = raw.all.map((c) => {
    // simple-git stores parents in c.refs if configured, or we can parse from the log
    // The DefaultLogFields don't include parents by default; we derive from the raw log
    // c.refs contains parent hashes separated by spaces (when available)
    const parentHashes: string[] = []
    // Try to extract parents from the commit — simple-git may populate
    // them in different fields depending on version
    const rawCommit = c as unknown as Record<string, unknown>
    if (Array.isArray(rawCommit.parents)) {
      parentHashes.push(...(rawCommit.parents as string[]))
    } else if (typeof rawCommit.refs === 'string') {
      // refs may contain parent info; best effort
      const refs = rawCommit.refs as string
      parentHashes.push(...refs.split(' ').filter((r: string) => r && !r.startsWith('refs/') && r !== c.hash))
    }

    const date = c.date ?? ''

    return {
      hash: c.hash,
      hashAbbrev: c.hash.substring(0, 7),
      message: c.message,
      author: c.author_name ?? '',
      authorEmail: c.author_email ?? '',
      date,
      parents: parentHashes,
      relativeDate: toRelativeDate(date),
    }
  })

  return {
    commits,
    total: raw.total,
  }
}

/**
 * GitOperationsManager provides typed methods for all Git operations.
 * It does not hold state — each call creates a fresh simple-git instance
 * scoped to the requested working directory.
 */
export class GitOperationsManager {
  /** Get the current branch name */
  async getBranch(cwd: string): Promise<string | null> {
    validateCwd(cwd)
    try {
      const result = await git(cwd).branch()
      return result.current || null
    } catch (err) {
      logger.debug(`getBranch failed for ${cwd}`, err)
      return null
    }
  }

  /** Get full git status */
  async getStatus(cwd: string): Promise<GitStatusResult> {
    validateCwd(cwd)
    try {
      const raw = await git(cwd).status()
      return mapStatus(raw)
    } catch (err) {
      logger.error(`getStatus failed for ${cwd}`, err)
      throw new Error(`Failed to get git status: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Get commit log */
  async getLog(cwd: string, maxCount: number = 50): Promise<GitLogResult> {
    validateCwd(cwd)
    // Validate maxCount is a positive integer
    if (!Number.isFinite(maxCount) || maxCount < 1) {
      maxCount = 50
    }
    maxCount = Math.floor(maxCount)
    try {
      const raw = await git(cwd).log({ maxCount })
      return mapLog(raw)
    } catch (err) {
      logger.error(`getLog failed for ${cwd}`, err)
      throw new Error(`Failed to get git log: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Get diff for a specific file or all files */
  async getDiff(cwd: string, filePath?: string, staged: boolean = false): Promise<GitDiffResult> {
    validateCwd(cwd)
    try {
      const g = git(cwd)
      let patch: string
      if (filePath) {
        patch = staged
          ? await g.diff(['--cached', '--', filePath])
          : await g.diff(['--', filePath])
      } else {
        patch = staged
          ? await g.diff(['--cached'])
          : await g.diff()
      }
      return { patch }
    } catch (err) {
      logger.error(`getDiff failed for ${cwd}`, err)
      throw new Error(`Failed to get diff: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Get a summary of file changes (insertions/deletions per file) */
  async getDiffSummary(cwd: string, staged: boolean = false): Promise<GitDiffSummaryResult> {
    validateCwd(cwd)
    try {
      const g = git(cwd)
      const raw = staged
        ? await g.diffSummary(['--cached'])
        : await g.diffSummary()
      
      const files: GitDiffSummaryEntry[] = raw.files.map((f) => ({
        file: f.file,
        insertions: 'insertions' in f ? f.insertions ?? 0 : 0,
        deletions: 'deletions' in f ? f.deletions ?? 0 : 0,
        binary: 'binary' in f ? f.binary ?? false : false,
      }))

      return {
        files,
        insertions: raw.insertions ?? 0,
        deletions: raw.deletions ?? 0,
      }
    } catch (err) {
      logger.error(`getDiffSummary failed for ${cwd}`, err)
      throw new Error(`Failed to get diff summary: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Stage a file */
  async stage(cwd: string, filePath: string): Promise<void> {
    validateCwd(cwd)
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('Invalid filePath: must be a non-empty string')
    }
    try {
      await git(cwd).add(filePath)
    } catch (err) {
      logger.error(`stage failed for ${cwd}/${filePath}`, err)
      throw new Error(`Failed to stage file: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Unstage a file. Uses `git rm --cached` for repos with zero commits, since `git reset HEAD` requires an existing HEAD. */
  async unstage(cwd: string, filePath: string): Promise<void> {
    validateCwd(cwd)
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('Invalid filePath: must be a non-empty string')
    }
    try {
      // Check if this repo has any commits — `git reset HEAD` fails on empty repos
      const hasCommits = await this.hasCommits(cwd)
      if (hasCommits) {
        await git(cwd).reset(['HEAD', '--', filePath])
      } else {
        // For repos with zero commits, use `git rm --cached` to unstage
        await git(cwd).rm(['--cached', filePath])
      }
    } catch (err) {
      logger.error(`unstage failed for ${cwd}/${filePath}`, err)
      throw new Error(`Failed to unstage file: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Stage all changes */
  async stageAll(cwd: string): Promise<void> {
    validateCwd(cwd)
    try {
      await git(cwd).add('-A')
    } catch (err) {
      logger.error(`stageAll failed for ${cwd}`, err)
      throw new Error(`Failed to stage all: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Unstage all changes. Uses `git rm --cached -r .` for repos with zero commits. */
  async unstageAll(cwd: string): Promise<void> {
    validateCwd(cwd)
    try {
      // Check if this repo has any commits — `git reset HEAD` fails on empty repos
      const hasCommits = await this.hasCommits(cwd)
      if (hasCommits) {
        await git(cwd).reset(['HEAD'])
      } else {
        // For repos with zero commits, use `git rm --cached -r .` to unstage all
        await git(cwd).rm(['--cached', '-r', '.'])
      }
    } catch (err) {
      logger.error(`unstageAll failed for ${cwd}`, err)
      throw new Error(`Failed to unstage all: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Check if the repo has at least one commit (HEAD exists) */
  private async hasCommits(cwd: string): Promise<boolean> {
    try {
      await git(cwd).raw(['rev-parse', '--verify', 'HEAD'])
      return true
    } catch {
      return false
    }
  }

  /** Commit staged changes with a message */
  async commit(cwd: string, message: string): Promise<GitCommitResult> {
    validateCwd(cwd)
    validateCommitMessage(message)
    try {
      const result = await git(cwd).commit(message)
      return {
        hash: result.commit ?? '',
        hashAbbrev: (result.commit ?? '').substring(0, 7),
        branch: result.branch ?? '',
      }
    } catch (err) {
      logger.error(`commit failed for ${cwd}`, err)
      throw new Error(`Failed to commit: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Push to remote */
  async push(cwd: string, remote?: string, branch?: string): Promise<void> {
    validateCwd(cwd)
    // Treat empty string remote/branch as undefined (not provided)
    const effectiveRemote = remote?.trim() || undefined
    const effectiveBranch = branch?.trim() || undefined
    try {
      if (effectiveRemote && effectiveBranch) {
        await git(cwd).push(effectiveRemote, effectiveBranch)
      } else {
        await git(cwd).push()
      }
    } catch (err) {
      logger.error(`push failed for ${cwd}`, err)
      throw new Error(`Failed to push: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Pull from remote */
  async pull(cwd: string, remote?: string, branch?: string): Promise<GitPullResult> {
    validateCwd(cwd)
    // Treat empty string remote/branch as undefined (not provided)
    const effectiveRemote = remote?.trim() || undefined
    const effectiveBranch = branch?.trim() || undefined
    try {
      const result = await git(cwd).pull(effectiveRemote, effectiveBranch)
      return {
        changed: (result.files?.length ?? 0) > 0,
        fileChanges: result.files?.length ?? 0,
        insertions: result.summary?.insertions ?? 0,
        deletions: result.summary?.deletions ?? 0,
      }
    } catch (err) {
      logger.error(`pull failed for ${cwd}`, err)
      throw new Error(`Failed to pull: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Fetch from remote */
  async fetch(cwd: string, remote?: string): Promise<void> {
    validateCwd(cwd)
    // Treat empty string remote as undefined (not provided)
    const effectiveRemote = remote?.trim() || undefined
    try {
      await git(cwd).fetch(effectiveRemote ? [effectiveRemote] : [])
    } catch (err) {
      logger.error(`fetch failed for ${cwd}`, err)
      throw new Error(`Failed to fetch: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** List branches */
  async branchList(cwd: string): Promise<GitBranchListResult> {
    validateCwd(cwd)
    try {
      const raw: BranchSummary = await git(cwd).branch(['-a'])
      const branches: GitBranchRef[] = Object.values(raw.branches).map((b) => ({
        name: b.name,
        // refName should be the full ref path, but simple-git only returns the short name
        // Prepend refs/heads/ for local branches if not already a full ref
        refName: b.name.startsWith('refs/') ? b.name : (b.name.startsWith('remotes/') ? b.name : `refs/heads/${b.name}`),
        current: b.current,
        commitHash: b.commit,
        commitMessage: b.label ?? '',
        isRemote: b.name.startsWith('remotes/'),
      }))

      return {
        branches,
        current: raw.current || null,
      }
    } catch (err) {
      logger.error(`branchList failed for ${cwd}`, err)
      throw new Error(`Failed to list branches: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Create a new branch */
  async branchCreate(cwd: string, name: string, checkout: boolean = true): Promise<void> {
    validateCwd(cwd)
    validateBranchName(name)
    try {
      if (checkout) {
        await git(cwd).checkoutBranch(name, 'HEAD')
      } else {
        await git(cwd).branch([name])
      }
    } catch (err) {
      logger.error(`branchCreate failed for ${cwd}`, err)
      throw new Error(`Failed to create branch: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Switch to a branch */
  async branchSwitch(cwd: string, name: string): Promise<void> {
    validateCwd(cwd)
    validateBranchName(name)
    try {
      await git(cwd).checkout(name)
    } catch (err) {
      logger.error(`branchSwitch failed for ${cwd}`, err)
      throw new Error(`Failed to switch branch: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Stash current changes */
  async stash(cwd: string, message?: string): Promise<void> {
    validateCwd(cwd)
    // Treat empty string message as undefined
    const effectiveMessage = message?.trim() || undefined
    try {
      if (effectiveMessage) {
        await git(cwd).stash(['push', '-m', effectiveMessage])
      } else {
        await git(cwd).stash()
      }
    } catch (err) {
      logger.error(`stash failed for ${cwd}`, err)
      throw new Error(`Failed to stash: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Pop the latest stash */
  async stashPop(cwd: string): Promise<void> {
    validateCwd(cwd)
    try {
      await git(cwd).stash(['pop'])
    } catch (err) {
      logger.error(`stashPop failed for ${cwd}`, err)
      throw new Error(`Failed to pop stash: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** List stashes */
  async stashList(cwd: string): Promise<GitStashListResult> {
    validateCwd(cwd)
    try {
      const raw = await git(cwd).stashList()
      const stashes: GitStashEntry[] = raw.all.map((entry, index) => {
        // Try to extract branch name from stash message (format: "On <branch>: <msg>")
        let branchName = ''
        const msg = entry.message ?? ''
        const branchMatch = msg.match(/^On (.+?): /)
        if (branchMatch) {
          branchName = branchMatch[1]
        }
        return {
          index,
          message: msg,
          branchName,
          hash: entry.hash ?? '',
          date: entry.date ?? '',
        }
      })
      return { stashes }
    } catch (err) {
      logger.error(`stashList failed for ${cwd}`, err)
      throw new Error(`Failed to list stashes: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Get remote URL */
  async getRemoteUrl(cwd: string, remote: string = 'origin'): Promise<string | null> {
    validateCwd(cwd)
    // Treat empty string remote as default
    const effectiveRemote = remote?.trim() || 'origin'
    try {
      const url = await git(cwd).remote(['get-url', effectiveRemote])
      return url || null
    } catch {
      // Remote may not exist — return null
      return null
    }
  }
}

/** Singleton instance for use across the main process */
export const gitOperationsManager = new GitOperationsManager()
