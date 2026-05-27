# GitHub Interaction

> **Status:** Planned | **Priority:** High | **Dependencies:** `isomorphic-git` or `simple-git`, `@gitgraph/react` or `commit-graph`

## Overview

Bring first-class Git/GitHub integration into NekoCode so developers can visualize their commit history as an interactive ancestor graph and perform day-to-day version control operations (commit, stage, push, pull, fetch, branch, etc.) without leaving the app. This feature transforms NekoCode from a pure AI coding assistant into a complete development environment.

The feature has two major pillars:

1. **Commit Graph Viewer** — A visual, interactive DAG (directed acyclic graph) rendering the commit ancestry of a repository, showing branches, merges, and tags at a glance.
2. **Git Command Center** — A dedicated UI panel housing all common Git operations (stage, commit, push, pull, fetch, branch, stash, diff) in one accessible location.

---

## Research Sources

### Commit Graph Visualization Libraries

| Library | React Support | Last Updated | npm Package | Notes |
|---|---|---|---|---|
| **`@gitgraph/react`** | Native React component | Archived (2019) | `@gitgraph/react` | Pretty rendering, programmatic API (you build the graph imperatively). Archived, no maintenance. Pagination not supported natively. Renders deleted-branch commits on same path. |
| **`commit-graph` (DoltHub)** | Native React component | Active (2024) | `commit-graph` | Built by DoltHub to replace `@gitgraph/react`. Supports pagination, virtualization, ancestor-order traversal. Canvas-based rendering. Straight-line paths. Branch labels on right side. |
| **Custom Canvas/SVG** | N/A | N/A | N/A | Full control over layout algorithm and rendering. Highest effort but most flexible. |

#### Key Finding: DoltHub's `commit-graph` is the Best Starting Point

DoltHub built their own commit graph npm package specifically because `@gitgraph/react` was archived and had poor pagination/customization. Their package (`commit-graph`) is:
- Active and maintained
- Designed for real repository commit data (not just demo diagrams)
- Supports virtual scrolling for large histories
- Canvas-based for performance
- Has a clean React component interface

**Recommendation:** Use `commit-graph` as the visualization engine, with potential to fork/customize later.

#### Git Operations Libraries

| Library | Platform | Async | Notes |
|---|---|---|---|
| **`isomorphic-git`** | Browser + Node | Yes | Pure JS, no native dependencies. Works in Electron renderer. Ideal for our case. |
| **`simple-git`** | Node only | Yes | Thin wrapper around system `git` CLI. Requires git installed. Runs in main process only. |
| **`nodegit`** | Node only | Yes | Native libgit2 bindings. Fast but complex native build. |

**Recommendation:** Use `simple-git` in the main process for Git operations. It leverages the system git binary (already required by NekoCode's project setup) and is battle-tested. The main process handles all Git operations and communicates results via IPC to the renderer.

---

## Key Technical Decisions

### 1. Main Process Owns All Git Operations

Git operations (commit, push, pull, fetch, log, diff, status) run exclusively in the **main process** via `simple-git`. The renderer never touches the filesystem directly for Git. This mirrors the existing architecture where `project-manager.ts` handles file operations and `session-manager.ts` handles AI sessions.

**Why:** Security (renderer is less trusted), consistency with existing IPC architecture, and `simple-git` requires Node.js `child_process` which is main-process only.

### 2. Commit Graph Runs in Renderer with Data from IPC

The commit graph component lives in the renderer and receives commit data via IPC. The main process queries `git log` with structured formatting, transforms the output into a typed `CommitNode[]`, and sends it to the renderer.

**Why:** The graph visualization is a UI concern. The renderer already handles complex UI (chat, sessions, settings). Sending pre-processed commit data keeps the renderer lightweight — it renders, it doesn't compute DAGs.

### 3. Git Panel as a Dedicated View (Not a Modal)

The Git Command Center is a **first-class view** alongside Chat and Settings, activated via a button in the NavBar or TreeSidebar. It is NOT a modal, NOT a popover. It replaces the chat area when active (same pattern as `SettingsView`).

**Why:** Git operations require sustained attention — staging hunks, writing commit messages, reviewing diffs. Modals and popovers feel cramped. A full view gives room for the commit graph + diff viewer + staging area.

### 4. Commit Graph is Lazy-Loaded

The commit graph data is not fetched until the user explicitly opens the Git view. Once loaded, it refreshes on:
- Manual refresh button
- After any Git operation (commit, pull, fetch, checkout)
- After a file save (to update the "unstaged changes" indicator)

**Why:** `git log --graph` on large repos can be slow. Don't penalize users who just want to chat with the AI.

---

## Architecture

### Data Flow

```text
Main Process                                    Renderer Process
-----------                                   ---------------
git-operations-manager.ts (NEW)
  |
  +- git.status(projectPath)  ----IPC---->   useGitOperations hook
  +- git.log(projectPath)     ----IPC---->     |
  +- git.diff(projectPath)    ----IPC---->     v
  +- git.commit(...)          <---IPC----   GitView.tsx (NEW)
  +- git.push(...)            <---IPC----     |
  +- git.pull(...)            <---IPC----     +- CommitGraphPanel
  +- git.fetch(...)           <---IPC----     |   (uses commit-graph lib)
  +- git.checkout(...)        <---IPC----     |
  +- git.stage(...)           <---IPC----     +- GitCommandCenter
  +- git.stash(...)           <---IPC----     |   +- StagingArea
  |                                            |   +- CommitInput
  |                                            |   +- ActionButtons
  |                                            |   +- DiffViewer
  |                                            |   +- BranchSelector
  v                                            |
project-manager.ts                             TreeSidebar.tsx
  (provides projectPath)                         +- Git status badge
                                                 +- Quick action button
```

### New Files

| File | Location | Purpose |
|---|---|---|
| `git-operations-manager.ts` | `src/main/` | All Git operations: status, log, diff, commit, push, pull, fetch, branch, stash, checkout, stage, unstage |
| `GitView.tsx` | `src/renderer/src/components/git/` | Main Git view container — hosts CommitGraph + GitCommandCenter |
| `CommitGraphPanel.tsx` | `src/renderer/src/components/git/` | Interactive commit graph visualization using `commit-graph` library |
| `GitCommandCenter.tsx` | `src/renderer/src/components/git/` | Container for staging area, commit input, and action buttons |
| `StagingArea.tsx` | `src/renderer/src/components/git/` | File list with stage/unstage toggles, diff preview on click |
| `CommitInput.tsx` | `src/renderer/src/components/git/` | Message textarea + commit button (with optional amend toggle) |
| `GitActions.tsx` | `src/renderer/src/components/git/` | Push, pull, fetch, stash action buttons with status indicators |
| `DiffViewer.tsx` | `src/renderer/src/components/git/` | Inline diff viewer for staged/unstaged changes (read-only) |
| `BranchSelector.tsx` | `src/renderer/src/components/git/` | Branch dropdown with create/switch/delete |
| `useGitOperations.ts` | `src/renderer/src/hooks/` | Hook wrapping all Git IPC calls with loading/error state |

### Modified Files

| File | Change |
|---|---|
| `src/shared/ipc-channels.ts` | Add all Git IPC channel constants |
| `src/shared/ipc-types.ts` | Add Git-related request/response types |
| `src/main/ipc-handlers.ts` | Register Git IPC handlers |
| `src/preload/index.ts` | Expose Git IPC methods to renderer |
| `src/renderer/src/App.tsx` | Add `GitView` as a view option alongside Chat/Settings |
| `src/renderer/src/components/layout/NavBar.tsx` | Add Git button (branch icon) to toggle Git view |
| `src/renderer/src/components/layout/TreeSidebar.tsx` | Add Git status badge (unstaged changes count), quick "open git" button |
| `src/renderer/src/stores/project-store.tsx` | Add `activeView: 'git'` option, `gitStatus` state |
| `src/main/index.ts` | Initialize `GitOperationsManager` on app startup |
| `src/main/threading/types.ts` | Add Git operation types for thread pool (optional, for heavy operations) |

---

## API Design

### IPC Channels

```typescript
// Add to src/shared/ipc-channels.ts

// --- Status & Info ---
GIT_STATUS: 'git:status',
GIT_LOG: 'git:log',
GIT_DIFF: 'git:diff',
GIT_BRANCHES: 'git:branches',
GIT_CURRENT_BRANCH: 'git:current-branch',
GIT_REMOTE_URL: 'git:remote-url',

// --- Staging & Commit ---
GIT_STAGE: 'git:stage',
GIT_UNSTAGE: 'git:unstage',
GIT_STAGE_ALL: 'git:stage-all',
GIT_UNSTAGE_ALL: 'git:unstage-all',
GIT_COMMIT: 'git:commit',
GIT_COMMIT_AMEND: 'git:commit-amend',

// --- Remote Operations ---
GIT_PUSH: 'git:push',
GIT_PULL: 'git:pull',
GIT_FETCH: 'git:fetch',

// --- Branch Operations ---
GIT_CHECKOUT: 'git:checkout',
GIT_CREATE_BRANCH: 'git:create-branch',
GIT_DELETE_BRANCH: 'git:delete-branch',
GIT_MERGE: 'git:merge',

// --- Stash ---
GIT_STASH_SAVE: 'git:stash-save',
GIT_STASH_POP: 'git:stash-pop',
GIT_STASH_LIST: 'git:stash-list',

// --- Events (main -> renderer) ---
GIT_OPERATION_PROGRESS: 'git:operation-progress',
GIT_STATUS_CHANGED: 'git:status-changed',
```

### Shared Types

```typescript
// Add to src/shared/ipc-types.ts

// --- Commit Graph Data ---
export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  refs: string[];       // branch names, tags pointing at this commit
  isMerge: boolean;
}

export interface CommitGraphData {
  commits: CommitNode[];
  branches: GitBranch[];
  currentBranch: string;
  hasMore: boolean;     // for pagination
  totalCount: number;
}

// --- Git Status ---
export interface GitFileStatus {
  path: string;
  oldPath?: string;             // for renames
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';
  staged: boolean;              // in index vs working tree
  binary: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;                // commits ahead of remote
  behind: number;               // commits behind remote
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
  conflicted: GitFileStatus[];
  stashCount: number;
  isClean: boolean;
}

// --- Branch ---
export interface GitBranch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommitDate: string;
  lastCommitMessage: string;
}

// --- Request/Response Types ---
export interface GitLogRequest {
  projectPath: string;
  branch?: string;
  maxCount?: number;            // for pagination
  skip?: number;
}

export interface GitDiffRequest {
  projectPath: string;
  filePath: string;
  staged: boolean;
}

export interface GitCommitRequest {
  projectPath: string;
  message: string;
  amend?: boolean;
}

export interface GitStageRequest {
  projectPath: string;
  filePaths: string[];
}

export interface GitPushRequest {
  projectPath: string;
  remote?: string;
  branch?: string;
  force?: boolean;
}

export interface GitPullRequest {
  projectPath: string;
  remote?: string;
  branch?: string;
}

export interface GitCheckoutRequest {
  projectPath: string;
  branch: string;
  createIfNotExists?: boolean;
}

export interface GitCreateBranchRequest {
  projectPath: string;
  name: string;
  startPoint?: string;
  checkout?: boolean;
}

export interface GitMergeRequest {
  projectPath: string;
  branch: string;
  noFastForward?: boolean;
}

export interface GitStashSaveRequest {
  projectPath: string;
  message?: string;
  includeUntracked?: boolean;
}

// --- Progress Events ---
export interface GitOperationProgress {
  operation: string;
  phase: 'started' | 'progress' | 'completed' | 'error';
  message?: string;
  percent?: number;
}
```

### Main Process: `git-operations-manager.ts`

```typescript
// Pseudocode for the manager interface
class GitOperationsManager {
  constructor()

  /** Get current working tree status */
  async getStatus(projectPath: string): Promise<GitStatus>
  // Uses: git.status(), git.diff('--cached'), git.diff()

  /** Get commit log with graph structure */
  async getLog(projectPath: string, options?: GitLogRequest): Promise<CommitGraphData>
  // Uses: git.log({'--graph': null, '--format': customFormat})
  // Parses into CommitNode[] with parent references for DAG rendering

  /** Get diff for a file */
  async getDiff(projectPath: string, options: GitDiffRequest): Promise<string>
  // Uses: git.diff() or git.diff('--cached')

  /** Stage files */
  async stage(projectPath: string, filePaths: string[]): Promise<void>
  // Uses: git.add(filePaths)

  /** Unstage files */
  async unstage(projectPath: string, filePaths: string[]): Promise<void>
  // Uses: git.reset(['HEAD', '--', ...filePaths])

  /** Stage all changes */
  async stageAll(projectPath: string): Promise<void>
  // Uses: git.add('-A')

  /** Unstage all changes */
  async unstageAll(projectPath: string): Promise<void>
  // Uses: git.reset('HEAD')

  /** Commit staged changes */
  async commit(projectPath: string, options: GitCommitRequest): Promise<string>
  // Uses: git.commit(message) or git.commit('--amend', message)
  // Returns: new commit hash

  /** Push to remote */
  async push(projectPath: string, options?: GitPushRequest): Promise<void>
  // Uses: git.push(remote, branch)

  /** Pull from remote */
  async pull(projectPath: string, options?: GitPullRequest): Promise<void>
  // Uses: git.pull(remote, branch)

  /** Fetch from remote */
  async fetch(projectPath: string, remote?: string): Promise<void>
  // Uses: git.fetch(remote)

  /** List branches */
  async getBranches(projectPath: string): Promise<GitBranch[]>
  // Uses: git.branch({'-a': null, '-v': null})

  /** Checkout a branch */
  async checkout(projectPath: string, options: GitCheckoutRequest): Promise<void>
  // Uses: git.checkout(branch) or git.checkout('-b', name)

  /** Create a branch */
  async createBranch(projectPath: string, options: GitCreateBranchRequest): Promise<void>
  // Uses: git.branch([name]) optionally + git.checkout()

  /** Merge a branch */
  async merge(projectPath: string, options: GitMergeRequest): Promise<string>
  // Uses: git.merge([branch])

  /** Stash changes */
  async stashSave(projectPath: string, options?: GitStashSaveRequest): Promise<void>
  // Uses: git.stash() or git.stash('--include-untracked')

  /** Pop stash */
  async stashPop(projectPath: string): Promise<void>
  // Uses: git.stash('pop')

  /** List stashes */
  async stashList(projectPath: string): Promise<string[]>
  // Uses: git.stashList()

  /** Watch for file changes that affect git status */
  watchProject(projectPath: string, callback: () => void): void
  // Uses: chokidar on .git/ directory for status change events
}
```

---

## UI Design

### View Activation

The Git view is activated by clicking a **Git branch icon** in the NavBar (next to the existing zoom controls). When active, `activeView` changes from `'chat'` to `'git'`, and the main content area shows `GitView` instead of `ChatView`.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ NavBar:  [NekoCode] [v0.2.x]    [Add Project] [Open VSCode]  [🔀 Git] [🔍±] [_][□][✕] │
├──────────┬──────────────────────────────────────────────────────────┤
│          │  ┌─────────────────────────────────────────────────────┐ │
│ Tree     │  │  Commit Graph (CommitGraphPanel)                   │ │
│ Sidebar  │  │  ●──●──●──●  main                                 │ │
│          │  │   ╲   ╲──●  feature/foo                           │ │
│ Project1 │  │    ●──●──●──●  develop                            │ │
│  Sess1   │  │         ╲──●  hotfix/bar                          │ │
│  Sess2   │  └─────────────────────────────────────────────────────┘ │
│          │  ┌───────────────────────┬─────────────────────────────┐ │
│ Project2 │  │  Staging Area        │  Diff Viewer                │ │
│  Sess1   │  │  ☐ M src/app.ts     │  - old line                 │ │
│          │  │  ☑ A src/new.ts      │  + new line                 │ │
│ [Git ●2] │  │  ☐ D src/old.ts     │                             │ │
│          │  │                      │                             │ │
│          │  │  [Commit message___] │                             │ │
│          │  │  [Stage All] [Commit]│                             │ │
│          │  ├───────────────────────┴─────────────────────────────┤ │
│          │  │  [Push] [Pull] [Fetch] [Stash] [Branch: develop ▾]│ │
│          │  └─────────────────────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────────────────┘
```

### Commit Graph Panel (`CommitGraphPanel.tsx`)

**Features:**
- Renders the commit DAG using the `commit-graph` npm package
- Each commit row shows: graph lane lines, commit hash, author, date, message, refs (branch names, tags)
- Click a commit to see its diff in the Diff Viewer below
- Ancestor order toggle (vs. date order) — mirrors SourceTree/GitKraken behavior
- Branch filter: show all branches, current branch only, or specific branches
- Virtual scrolling for repos with thousands of commits
- Current branch highlighted with accent color
- Remote tracking branches shown as dashed lines
- Merge commits rendered with proper lane convergence

**Color Scheme (Dark Theme):**
- Each branch lane gets a distinct color from a palette: `['#4FC3F7', '#81C784', '#FFB74D', '#E57373', '#BA68C8', '#4DD0E1', '#AED581', '#FF8A65']`
- Current branch: bold accent color (`#4FC3F7`)
- Commit dots: filled circles, current branch = larger
- Merge lines: smooth bezier curves connecting parent lanes
- HEAD indicator: small arrow or tag icon

### Git Command Center (`GitCommandCenter.tsx`)

**Staging Area:**
- Two-column layout: **Unstaged** (left) / **Staged** (right)
- Each file shows: status icon (M/A/D/R/?), file path, expand chevron for inline diff
- Click a file to see its diff in the Diff Viewer
- Click the stage/unstage icon (→/←) to move files between columns
- "Stage All" / "Unstage All" buttons at the top of each column
- Hunk-level staging: expand a file to see individual hunks with stage/discard buttons

**Commit Input:**
- Textarea for commit message (with optional description/body)
- "Commit" button (disabled when no files staged)
- "Commit & Push" dropdown option
- "Amend Previous Commit" toggle
- Co-author input (optional)

**Action Bar:**
- `Push` — with ahead count badge (e.g., "Push (3)")
- `Pull` — with behind count badge (e.g., "Pull (1)")
- `Fetch` — with loading spinner during fetch
- `Stash` — dropdown with Save / Pop / List
- `Branch` selector — dropdown with current branch, create/switch/delete actions

### TreeSidebar Integration

- **Git status badge** on each project: small colored dot indicating uncommitted changes (green = clean, yellow = modified, red = conflicts)
- **Unstaged count badge** (e.g., "3") next to the Git quick-action button
- **Quick Git button** at the bottom of the sidebar: opens Git view directly

### Diff Viewer (`DiffViewer.tsx`)

- Side-by-side or inline diff mode toggle
- Syntax highlighting for common file types (use Monaco editor diff mode if feasible, or a lightweight diff renderer)
- Line numbers for both old and new content
- Expand/collapse for unchanged sections (collapsed by default, showing context lines)
- Minimap for quick navigation in large diffs
- Binary file indicator (no diff, show file name and size)

---

## What Matters (Critical Requirements)

### 1. Correctness Over Performance

Git operations must be **correct** first. A failed `git push` that silently loses data is unacceptable. Every operation must:
- Return clear success/failure status
- Show error messages from `git` verbatim (no swallowing)
- Handle merge conflicts explicitly (show conflicted files, don't auto-resolve)

### 2. Never Block the UI

All Git operations are async. The UI must show:
- Loading state during operations (spinner on the button)
- Progress for long operations (push/pull on large repos)
- Never freeze the renderer — use IPC, not direct FS access

### 3. Respect the `.git` Directory

Never modify `.git/config`, `.git/hooks`, or other internal git files. Only use the `simple-git` API which goes through the `git` binary. This ensures compatibility with all git features (LFS, submodules, worktrees).

### 4. Merge Conflict Awareness

When a `pull` or `merge` results in conflicts:
- Detect conflicted files from `git status`
- Show them prominently in the Staging Area with a red "conflict" badge
- Offer "Open in VS Code" for manual resolution (NekoCode is not a merge tool)
- "Mark as Resolved" button after user edits the file

### 5. Commit Graph Readability

The commit graph must be **readable at a glance**. This means:
- Branch lanes are consistently colored (same branch = same color)
- Current branch is visually prominent
- Merge points are clear (two lines converging)
- Commit messages are truncated sensibly (show first line, expand on hover)
- No horizontal scrolling — graph adapts to the number of visible branch lanes

### 6. Status Badge Accuracy

The Git status badge in the TreeSidebar must be **always accurate**. It should refresh:
- On window focus (user may have committed externally)
- After any Git operation within NekoCode
- On a 30-second polling interval as fallback

---

## What Does NOT Matter (Non-Goals / Deferred)

### 1. Full GitHub/GitLab Integration (Phase 2+)

This feature is about **local Git operations**. Creating pull requests, browsing issues, and viewing CI status are NOT in scope. These require OAuth, API integrations, and per-platform adapters. Defer to Phase 2.

### 2. Interactive Rebase

Interactive rebase (`git rebase -i`) requires a complex multi-step UI (reorder commits, edit messages, squash, etc.). This is extremely error-prone to implement as a GUI. Defer — users can use the terminal for this.

### 3. Merge Conflict Resolution Tool

Building a 3-way merge editor is a massive undertaking (see VS Code's implementation). For now, detect conflicts and direct users to VS Code or their preferred merge tool. NekoCode's role is awareness, not resolution.

### 4. Submodule Management

Submodules add significant complexity to status, diff, and commit operations. Ignore submodule internals for Phase 1 — just show submodule repos as single files.

### 5. Git LFS Support

LFS operations (`git lfs pull`, `git lfs push`) are separate from core Git. Don't implement LFS-specific operations. If the user has LFS configured, `simple-git` will pass through LFS smudge/clean filters transparently.

### 6. Multiple Remotes

Phase 1 supports a single remote (`origin`). Managing multiple remotes (adding, removing, pushing to different remotes) is deferred.

### 7. Tag Management

Creating, deleting, and pushing tags is deferred. Tags are shown in the commit graph as labels but cannot be created from the UI yet.

### 8. Blame / Annotate

`git blame` is useful but orthogonal to this feature. It belongs in the editor context (Monaco), not the Git view. Defer.

### 9. Git Hooks Management

NekoCode should not manage git hooks. If the user has pre-commit hooks, `simple-git` will execute them automatically during `git commit`. That's sufficient.

---

## Edge Cases & Mitigations

| Issue | Mitigation |
|---|---|
| `git` binary not found on system | Detect on startup, show clear error in Git view, disable Git features gracefully |
| Repo has no commits yet (fresh `git init`) | Show "No commits yet" placeholder with initial commit prompt |
| Detached HEAD state | Show warning banner, disable push/pull, allow checkout to a branch |
| Large repo (10,000+ commits) | Paginate the commit graph (load 100 at a time), virtual scrolling |
| Binary files in diff | Show "Binary file" indicator with size, no diff content |
| `.gitignore` changes | Re-scan status after `.gitignore` modification |
| Concurrent external Git operations | Refresh status before every operation, detect changes via `.git/index` mtime |
| Push rejected (non-fast-forward) | Show clear error: "Pull first — remote has new commits" |
| Merge conflict during pull | Show conflict files prominently, offer "Open in VS Code" |
| Very long branch names | Truncate in dropdown with tooltip showing full name |
| CRLF/LF line ending changes showing in diff | Configure `core.autocrlf` awareness, show line ending changes explicitly |
| Commit with empty message | Prevent — require non-empty commit message in the UI |
| Amend with already-pushed commit | Warn: "This commit was already pushed. Amending will require force push." |

---

## Implementation Phases

### Phase 1: Foundation — Git Status & Basic Operations (Highest Value)

**Scope:** GitOperationsManager + Staging/Commit/Push/Pull + status badge

- [ ] Add `simple-git` dependency: `bun add simple-git`
- [ ] Create `src/main/git-operations-manager.ts` with status, stage, unstage, commit, push, pull, fetch
- [ ] Add IPC channels and types to `src/shared/`
- [ ] Register Git IPC handlers in `src/main/ipc-handlers.ts`
- [ ] Expose Git IPC in `src/preload/index.ts`
- [ ] Create `src/renderer/src/hooks/useGitOperations.ts` hook
- [ ] Create `src/renderer/src/components/git/GitView.tsx` (empty shell)
- [ ] Create `src/renderer/src/components/git/GitCommandCenter.tsx` with StagingArea + CommitInput + ActionButtons
- [ ] Create `src/renderer/src/components/git/StagingArea.tsx`
- [ ] Create `src/renderer/src/components/git/CommitInput.tsx`
- [ ] Create `src/renderer/src/components/git/GitActions.tsx`
- [ ] Create `src/renderer/src/components/git/DiffViewer.tsx` (basic inline diff)
- [ ] Add Git button to `NavBar.tsx`
- [ ] Add `activeView: 'git'` to `project-store.tsx`
- [ ] Update `App.tsx` to render `GitView` when `activeView === 'git'`
- [ ] Add Git status badge to `TreeSidebar.tsx`
- [ ] Initialize `GitOperationsManager` in `src/main/index.ts`
- [ ] Write unit tests for `GitOperationsManager`
- [ ] Write renderer tests for Git view components

**Effort:** Large
**Value:** 60% of feature value — users can commit, stage, push, pull without leaving the app

### Phase 2: Commit Graph Visualization

**Scope:** Interactive commit graph with ancestor ordering

- [ ] Add `commit-graph` dependency: `bun add commit-graph`
- [ ] Create `src/renderer/src/components/git/CommitGraphPanel.tsx`
- [ ] Implement `getLog()` in `GitOperationsManager` with DAG-compatible output
- [ ] Render commit graph using `commit-graph` React component
- [ ] Add ancestor order vs. date order toggle
- [ ] Add branch filter dropdown
- [ ] Implement click-to-diff: clicking a commit shows its diff
- [ ] Add virtual scrolling for large histories
- [ ] Style the graph to match NekoCode's dark theme
- [ ] Write integration tests

**Effort:** Medium-Large
**Value:** 25% of feature value — visual history understanding

### Phase 3: Branch Management & Stash

**Scope:** Branch selector, create/switch/delete, stash operations

- [ ] Create `src/renderer/src/components/git/BranchSelector.tsx`
- [ ] Implement branch operations in `GitOperationsManager` (checkout, create, delete, merge)
- [ ] Add stash save/pop/list UI
- [ ] Add stash indicator in GitCommandCenter
- [ ] Write tests

**Effort:** Medium
**Value:** 10% of feature value

### Phase 4: Polish & Advanced Features

**Scope:** Hunk-level staging, side-by-side diff, Monaco diff integration, keyboard shortcuts

- [ ] Hunk-level staging in StagingArea (expand file to see hunks)
- [ ] Side-by-side diff mode toggle in DiffViewer
- [ ] Monaco editor diff integration (if feasible without bundle size regression)
- [ ] Keyboard shortcuts: `Ctrl+Shift+G` to open Git view, `Ctrl+Enter` to commit
- [ ] Co-author input in CommitInput
- [ ] "Commit & Push" one-click action
- [ ] Amend previous commit with warning
- [ ] Detached HEAD state handling

**Effort:** Medium
**Value:** 5% of feature value (polish)

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `simple-git` | ^3.x | Git operations via CLI in main process |
| `commit-graph` | ^1.x | React commit graph visualization component |
| `diff` or `diff2html` | ^5.x / ^3.x | Diff parsing and rendering (if not using Monaco) |

**Existing dependencies used:**
- `chokidar` (already in Electron) — watch `.git/` for status changes
- IPC bridge — already established pattern
- Tailwind CSS + Radix UI — consistent styling
- `project-store.tsx` — state management

---

## Testing Strategy

| Test Type | What to Test |
|---|---|
| Unit | `GitOperationsManager.getStatus()` returns correct `GitStatus` shape |
| Unit | `GitOperationsManager.commit()` handles empty message rejection |
| Unit | `GitOperationsManager.stage()` / `unstage()` move files between states |
| Unit | `GitOperationsManager.getLog()` produces valid `CommitNode[]` with parent refs |
| Unit | `useGitOperations` hook returns loading/error/data states correctly |
| Integration | IPC flow: renderer calls stage -> main executes `git add` -> status refreshes |
| Integration | IPC flow: renderer calls commit -> main executes `git commit` -> graph refreshes |
| Integration | Push/pull with actual remote (use local bare repo as mock remote) |
| Component | `StagingArea` renders staged/unstaged files with correct status icons |
| Component | `CommitInput` disables commit button when no files staged |
| Component | `CommitGraphPanel` renders commits with correct branch lane colors |
| Component | `DiffViewer` renders inline diff with added/removed line highlighting |
| E2E | Full workflow: modify file -> stage -> commit -> push -> graph updates |
| E2E | Merge conflict detection: pull creates conflicts -> UI shows conflict state |
| Manual | Commit graph readability on repo with 20+ branches |
| Manual | Performance on repo with 10,000+ commits |
| Manual | Push rejection handling (non-fast-forward) |
| Manual | Concurrent external Git operations (commit externally, then in NekoCode) |

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Credential storage | Never store Git credentials. Rely on system credential helper (osxkeychain, wincred, etc.) |
| Force push protection | Warn before force push, require explicit confirmation |
| Sensitive files in diff | No special handling — same as `git diff`. Users manage `.gitignore` |
| SSH key access | Never access SSH keys. `simple-git` uses system git which uses system SSH agent |
| `.git` directory integrity | Never write to `.git/` directly. All operations through `simple-git` |
