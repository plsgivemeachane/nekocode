/**
 * GitView — Top-level container for the Git feature view.
 * This is the component rendered when the user switches to the "Git" view
 * in the NavBar. Uses shadcn/ui Tabs for navigation between
 * Source Control, Commit Graph, and Stash Manager views.
 */

import React from 'react'
import { GitCommandCenter } from './GitCommandCenter'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/tabs'

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GitView() {
  return (
    <div className="flex flex-col h-full bg-surface-900 text-text-primary">
      <Tabs defaultValue="source-control" className="flex flex-col h-full">
        {/* Tab bar */}
        <TabsList className="w-full justify-start rounded-none border-b border-surface-800/50 bg-surface-950/50 px-2 h-9">
          <TabsTrigger
            value="source-control"
            className="text-xs text-text-secondary data-[state=active]:text-accent-400 data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-accent-400 rounded-none px-3 py-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mr-1.5 shrink-0">
              <path d="M1.5 4v9h13V4H1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              <path d="M4 6.5h8M4 9h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
            Source Control
          </TabsTrigger>
          <TabsTrigger
            value="commit-graph"
            className="text-xs text-text-secondary data-[state=active]:text-accent-400 data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-accent-400 rounded-none px-3 py-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mr-1.5 shrink-0">
              <circle cx="8" cy="3" r="1.5" stroke="currentColor" strokeWidth="1" />
              <circle cx="4" cy="8" r="1.5" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="8" r="1.5" stroke="currentColor" strokeWidth="1" />
              <circle cx="8" cy="13" r="1.5" stroke="currentColor" strokeWidth="1" />
              <path d="M7 4L4.5 7M9 4l2.5 3M5 9l2.5 3M11 9l-2.5 3" stroke="currentColor" strokeWidth="0.8" />
            </svg>
            Commit Graph
          </TabsTrigger>
          <TabsTrigger
            value="stash"
            className="text-xs text-text-secondary data-[state=active]:text-accent-400 data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-accent-400 rounded-none px-3 py-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mr-1.5 shrink-0">
              <rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1" />
              <rect x="2" y="7" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1" />
              <rect x="2" y="11" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1" />
            </svg>
            Stash
          </TabsTrigger>
        </TabsList>

        {/* Tab content */}
        <TabsContent value="source-control" className="flex-1 mt-0 overflow-hidden">
          <GitCommandCenter />
        </TabsContent>

        <TabsContent value="commit-graph" className="flex-1 mt-0 overflow-hidden">
          <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
            <div className="text-center">
              <svg width="32" height="32" viewBox="0 0 16 16" fill="none" className="mx-auto mb-3 text-text-tertiary/50">
                <circle cx="8" cy="3" r="1.5" stroke="currentColor" strokeWidth="1" />
                <circle cx="4" cy="8" r="1.5" stroke="currentColor" strokeWidth="1" />
                <circle cx="12" cy="8" r="1.5" stroke="currentColor" strokeWidth="1" />
                <circle cx="8" cy="13" r="1.5" stroke="currentColor" strokeWidth="1" />
                <path d="M7 4L4.5 7M9 4l2.5 3M5 9l2.5 3M11 9l-2.5 3" stroke="currentColor" strokeWidth="0.8" />
              </svg>
              <p className="font-medium">Commit Graph</p>
              <p className="text-xs mt-1 text-text-tertiary/60">Visual commit history coming soon</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="stash" className="flex-1 mt-0 overflow-hidden">
          <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
            <div className="text-center">
              <svg width="32" height="32" viewBox="0 0 16 16" fill="none" className="mx-auto mb-3 text-text-tertiary/50">
                <rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1" />
                <rect x="2" y="7" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1" />
                <rect x="2" y="11" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1" />
              </svg>
              <p className="font-medium">Stash Manager</p>
              <p className="text-xs mt-1 text-text-tertiary/60">Stash management coming soon</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
