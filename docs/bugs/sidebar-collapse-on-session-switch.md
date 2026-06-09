# Sidebar Folders Collapse When Switching Sessions Across Projects

date: 2026-06-09
severity: UX
status: fixed
component: TreeSidebar

## Bug Description

When the user switches from a session in one project folder to a session in a different project folder, the previously expanded folder collapses. This defeats the purpose of allowing multiple project folders to be expanded simultaneously - the user loses their place and must manually re-expand folders they had open.

The original "auto-collapse" behavior was designed to ensure the sidebar only shows sessions for the active project, but it actively harms the user experience when working across multiple projects. Users want to keep multiple folders expanded and visible while switching between sessions.

## Root Cause

In `src/renderer/src/components/layout/TreeSidebar.tsx`, the `useEffect` that reacts to `activeSessionId` changes (around line 290) was replacing the entire `expanded` Set with only the project containing the active session:

```typescript
// OLD - replaced entire set, collapsing all other folders
if (activeProject) {
  setExpanded(new Set([activeProject.id]))
}
```

This meant every time `activeSessionId` changed, all other expanded folders were collapsed and only the target project's folder remained expanded.

## Fix

Changed the `setExpanded` call to ADD the active project's folder to the existing expanded set instead of replacing it. Other folders remain expanded when switching sessions:

```typescript
// NEW - adds to existing set without collapsing others
if (activeProject) {
  setExpanded(prev => {
    if (prev.has(activeProject.id)) return prev
    const next = new Set(prev)
    next.add(activeProject.id)
    return next
  })
}
```

The `if (prev.has(activeProject.id)) return prev` check is an optimization to avoid unnecessary re-renders when the folder is already expanded.

## Behavior After Fix

- **On app open**: The folder containing the most recent session is auto-expanded (same as before)
- **On session switch**: The target folder is expanded, but other expanded folders are NOT collapsed
- **Manual toggle**: Users can still manually expand/collapse any folder via click
- **New project added**: New projects are auto-expanded (same as before, separate useEffect)
