# Git Integration UX Overhaul

**Date:** 2026-05-28
**Status:** Fixed
**Severity:** UX/Design — Multiple issues

## Bug Description

The Git integration had four major UX/design flaws:

1. **Git button in wrong location:** The Git button was placed in the TreeSidebar bottom area alongside Settings, instead of being in the NavBar next to "Open in VS Code" where action buttons belong.

2. **Git as page navigation instead of modal:** Git was implemented as a full page replacement (via `activeView: 'git'`), replacing the chat view entirely. Since Git operations are project-dependent and temporary, they should overlay the current session rather than replace it.

3. **Color scheme completely off:** All Git components used hardcoded Catppuccin-style colors (`bg-[#181825]`, `bg-[#1e1e2e]`, `text-gray-200`, `text-gray-500`, `border-white/5`, `hover:bg-white/10`) instead of the app's design system tokens (`bg-surface-*`, `text-text-*`, `border-surface-*`). This made Git components look visually disconnected from the rest of the dark neutral theme.

4. **Half-screen left-aligned panel:** The Git view only occupied the left portion of the screen, not a full overlay. The user wanted a centered modal with blur background that overlaps the current session.

## Root Cause

- Git was designed as a "view" (like Settings) in the `ActiveView` union type, causing it to replace the chat content area
- Button placement followed a "sidebar bottom" pattern (settings-like) rather than a "navbar action" pattern (VSCode-like)
- Color tokens were hardcoded during initial implementation without using the established design system
- No modal/overlay component pattern was established for project-context-dependent features

## Fix Applied

### 1. Added `showGitOverlay` state to project store
- Added `showGitOverlay: boolean` to `ProjectState`
- Added `SET_GIT_OVERLAY` action to the reducer
- Added `setGitOverlay(show: boolean)` method to `ProjectStoreAPI`
- Removed `'git'` from `ActiveView` type union (now just `'chat' | 'settings'`)
- `SET_ACTIVE_SESSION` and `SET_ACTIVE_VIEW` now also close the Git overlay (`showGitOverlay: false`)

### 2. Moved Git button to NavBar
- Added Git button to NavBar with identical style as "Open in VS Code" (`bg-surface-800/60`, `border-surface-600/30`, `shadow-sm shadow-surface-900/50`, `rounded-lg`)
- Uses the same branch icon (3-circle git branch SVG)
- Positioned before the "Open in VS Code" split button

### 3. Removed Git button from TreeSidebar
- Removed Git button and its surrounding layout from TreeSidebar bottom area
- Only Settings button remains in sidebar bottom

### 4. Converted GitView to modal overlay in App.tsx
- Replaced `<GitView />` page rendering with a fixed overlay modal
- Modal features:
  - Full-viewport backdrop with `bg-surface-950/70 backdrop-blur-md`
  - Centered content panel: `w-[calc(100vw-80px)] h-[calc(100vh-80px)] max-w-[1400px]`
  - Rounded corners (`rounded-2xl`) with subtle border
  - Header bar with Git icon + title + close button (X)
  - Close on: X button click, Escape key, backdrop click
  - Renders `<GitCommandCenter />` inside the modal

### 5. Fixed all Git component color schemes

| Component | Before | After |
|-----------|--------|-------|
| GitView container | `bg-[#181825] text-gray-200` | `bg-surface-900 text-text-primary` |
| GitCommandCenter toolbar border | `border-white/5` | `border-surface-800/50` |
| GitCommandCenter stash button | `hover:bg-white/10` | `hover:bg-surface-800/60 text-text-secondary` |
| GitCommandCenter refresh button | `text-gray-400 hover:text-white` | `text-text-tertiary hover:text-text-primary` |
| GitCommandCenter commits section | `border-white/5`, `text-gray-400`, `bg-white/[0.02]` | `border-surface-800/50`, `text-text-tertiary`, `bg-surface-900/60` |
| BranchSelector dropdown | `border-white/10 bg-[#1e1e2e]` | `border-surface-700/50 bg-surface-900` |
| BranchSelector button | `hover:bg-white/10` | `hover:bg-surface-800/60 text-text-secondary` |
| BranchSelector new branch input | `border-white/10 bg-black/20`, `placeholder:text-gray-500` | `border-surface-700/50 bg-surface-950`, `placeholder:text-text-tertiary` |
| GitActions border | `border-white/5` | `border-surface-800/50` |
| GitActions buttons | `hover:bg-white/10` | `hover:bg-surface-800/60 text-text-secondary` |
| StagingArea file rows | `hover:bg-white/5` | `hover:bg-surface-800/40 text-text-secondary` |
| StagingArea action buttons | `hover:bg-white/10` | `hover:bg-surface-800/60` |
| StagingArea untracked status | `text-gray-500` | `text-text-tertiary` |
| CommitInput textarea | `border-white/10 bg-black/20`, `placeholder:text-gray-500` | `border-surface-700/50 bg-surface-950`, `placeholder:text-text-tertiary` |
| CommitInput disabled state | `bg-white/5 text-gray-500` | `bg-surface-800/40 text-text-tertiary` |
| DiffViewer loading/empty | `text-gray-500` | `text-text-tertiary` |
| DiffViewer header | `border-white/5 text-gray-300` | `border-surface-800/50 text-text-secondary` |
| DiffViewer context lines | `text-gray-300` | `text-text-secondary` |

## Files Changed

- `src/renderer/src/stores/project-store.tsx` — Added `showGitOverlay` state, `SET_GIT_OVERLAY` action, `setGitOverlay()` method; removed `'git'` from `ActiveView`
- `src/renderer/src/App.tsx` — Replaced GitView page with modal overlay; added Escape key handler; imported `GitCommandCenter` instead of `GitView`
- `src/renderer/src/components/layout/NavBar.tsx` — Added Git button next to "Open in VS Code"; destructured `setGitOverlay`
- `src/renderer/src/components/layout/TreeSidebar.tsx` — Removed Git button from sidebar bottom
- `src/renderer/src/components/git/GitView.tsx` — Fixed container color to design system
- `src/renderer/src/components/git/GitCommandCenter.tsx` — Fixed all color tokens (11 replacements)
- `src/renderer/src/components/git/BranchSelector.tsx` — Fixed all color tokens (9 replacements)
- `src/renderer/src/components/git/GitActions.tsx` — Fixed all color tokens (4 replacements)
- `src/renderer/src/components/git/StagingArea.tsx` — Fixed all color tokens (6 replacements)
- `src/renderer/src/components/git/CommitInput.tsx` — Fixed all color tokens (2 replacements)
- `src/renderer/src/components/git/DiffViewer.tsx` — Fixed all color tokens (4 replacements)

## Verification

- `bun run type-check` — Passes (no TypeScript errors)
- `bun run lint` — Passes (no ESLint errors)
