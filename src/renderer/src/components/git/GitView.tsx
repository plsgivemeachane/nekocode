/**
 * GitView — Top-level container for the Git feature view.
 * This is the component rendered when the user switches to the "Git" view
 * in the NavBar. It renders GitCommandCenter as its content.
 *
 * Future phases will add tabs for Commit Graph, Stash Manager, etc.
 */

import React from 'react'
import { GitCommandCenter } from './GitCommandCenter'

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GitView() {
  return (
    <div className="flex flex-col h-full bg-surface-900 text-text-primary">
      {/*
        Phase 1: Just the command center.
        Phase 2: Add tab bar for "Source Control" / "Commit Graph" tabs.
        Phase 3: Add Stash Manager tab.
      */}
      <GitCommandCenter />
    </div>
  )
}
