/**
 * RightSidebar — Dashboard-style right panel with icon rail + content panel.
 *
 * Architecture:
 * - Always-visible icon rail (48px wide, full height) with clickable icons
 * - Clicking an icon toggles its content panel (click again to close)
 * - Content panel slides out from the icon rail with the selected panel's content
 * - Resizable content panel width via drag handle on the LEFT edge of the sidebar
 * - Drag handle appears as a small floating stick indicator (like a scrollbar thumb)
 * - Escape key closes the active panel
 *
 * Layout: [Resize Handle] [Icon Rail (48px)] [Content Panel (variable width)]
 *
 * Currently supported panels:
 * - "diff": File changes viewer (SessionDiffView)
 * - "outline": Placeholder for future file outline / symbols
 */

import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { useProjectStore, type RightSidebarPanel } from '../../stores/project-store'
import { useSessionMessages } from '../../contexts/session-messages-context'
import { SessionDiffView } from '../chat/SessionDiffView'
import type { DiffEntry } from '../chat/SessionDiffView'
import { extractDiffStats } from '../chat/tool-summary'
import type { ChatMessage } from '../../types/chat'

// ---------------------------------------------------------------------------
// Icon definitions for the rail
// ---------------------------------------------------------------------------

interface RailItem {
  id: Exclude<RightSidebarPanel, null>
  label: string
  icon: React.ReactNode
}

const RAIL_ITEMS: RailItem[] = [
  {
    id: 'diff',
    label: 'Changes',
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
        <path d="M1.5 3L6 1l4.5 2v3L6 8l-4.5-2V3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M1.5 8L6 10l4.5-2" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M1.5 11.5L6 13.5l4.5-2" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'outline',
    label: 'Outline',
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
        <path d="M2 3h8M2 6h12M2 9h6M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
]

// ---------------------------------------------------------------------------
// Diff entry builder (extracted from old ActivityRail)
// ---------------------------------------------------------------------------

function buildDiffEntries(messages: ChatMessage[]): DiffEntry[] {
  const entries: DiffEntry[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant' || msg.type !== 'tool_call' || msg.status !== 'done') continue

    const short = msg.toolName.replace(/^toolcall_/, '')
    const args = msg.args as Record<string, unknown> | null | undefined
    const result = msg.result as Record<string, unknown> | null | undefined

    if (!args) continue

    if (short === 'write') {
      const filePath = typeof args.path === 'string' ? args.path : ''
      const newContent = typeof args.content === 'string' ? args.content : ''
      const previousContent = typeof result?.previousContent === 'string' ? result.previousContent : ''

      if (!filePath || !newContent) continue
      if (previousContent === newContent) continue

      const stats = extractDiffStats(msg.toolName, args, result)
      entries.push({
        id: msg.id,
        filePath,
        toolName: short,
        oldContent: previousContent,
        newContent,
        stats: stats ?? { added: 0, removed: 0 },
      })
    } else if (short === 'edit') {
      const filePath = typeof args.path === 'string' ? args.path : ''
      if (!filePath) continue

      const rawEdits = args.edits
      const edits = Array.isArray(rawEdits) ? rawEdits : []
      if (edits.length === 0) continue

      let oldContent = ''
      let newContent = ''
      for (const edit of edits) {
        const e = edit as Record<string, unknown>
        const oldText = typeof e.oldText === 'string' ? e.oldText : ''
        const newText = typeof e.newText === 'string' ? e.newText : ''
        oldContent += oldText + '\n'
        newContent += newText + '\n'
      }

      const stats = extractDiffStats(msg.toolName, args, result)
      entries.push({
        id: msg.id,
        filePath,
        toolName: short,
        oldContent,
        newContent,
        stats: stats ?? { added: 0, removed: 0 },
      })
    }
  }

  return entries
}

// ---------------------------------------------------------------------------
// Content panels — one per RightSidebarPanel value
// ---------------------------------------------------------------------------

function DiffPanel({ diffEntries, selectedId }: { diffEntries: DiffEntry[]; selectedId: string | null }) {
  const handleSelectEntry = useCallback((_id: string) => {
    // Future: could update selection state for highlighting
  }, [])

  return (
    <SessionDiffView
      entries={diffEntries}
      selectedId={selectedId}
      onSelectEntry={handleSelectEntry}
    />
  )
}

function OutlinePanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm p-4">
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="mb-3 opacity-40">
        <path d="M2 3h8M2 6h12M2 9h6M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className="text-xs opacity-60">File outline coming soon</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RightSidebar() {
  const { state, setRightSidebarPanel, setRightSidebarWidth } = useProjectStore()
  const { messages, registerToolCallClickHandler } = useSessionMessages()

  const activePanel = state.rightSidebarActivePanel
  const width = state.rightSidebarWidth
  const selectedToolCallId = state.rightSidebarSelectedToolCallId

  // Resize drag state
  const isDraggingRef = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const [isHoveringResize, setIsHoveringResize] = useState(false)
  const [isDraggingState, setIsDraggingState] = useState(false)

  // Build diff entries from messages
  const diffEntries = useMemo(() => buildDiffEntries(messages), [messages])
  const diffCount = diffEntries.length

  // Register the tool call click handler so ChatView's ToolCallGroup can open this sidebar
  useEffect(() => {
    registerToolCallClickHandler((toolCallId: string) => {
      setRightSidebarPanel('diff', toolCallId)
    })
  }, [registerToolCallClickHandler, setRightSidebarPanel])

  // Handle Escape key to close the active panel
  useEffect(() => {
    if (!activePanel) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setRightSidebarPanel(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activePanel, setRightSidebarPanel])

  // Scroll to the selected diff entry when the diff panel opens or selection changes
  useEffect(() => {
    if (activePanel !== 'diff' || !selectedToolCallId) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`diff-entry-${selectedToolCallId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [activePanel, selectedToolCallId])

  // Toggle a panel: clicking an active icon closes it, clicking inactive opens it
  const handleIconClick = useCallback(
    (panelId: Exclude<RightSidebarPanel, null>) => {
      setRightSidebarPanel(activePanel === panelId ? null : panelId)
    },
    [activePanel, setRightSidebarPanel],
  )

  // --- Resize handle ---
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      setIsDraggingState(true)
      startX.current = e.clientX
      startWidth.current = width

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return
        // Dragging left = wider sidebar (width increases as mouse moves left)
        const delta = startX.current - moveEvent.clientX
        const newWidth = Math.max(280, Math.min(900, startWidth.current + delta))
        setRightSidebarWidth(newWidth)
      }

      const handleMouseUp = () => {
        isDraggingRef.current = false
        setIsDraggingState(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [width, setRightSidebarWidth],
  )

  // Compute badge counts per panel (excluding null)
  const badgeCounts: Record<string, number> = useMemo(
    () => ({
      diff: diffCount,
    }),
    [diffCount],
  )

  return (
    <div className="flex h-full shrink-0 relative">
      {/* ═══════ Resize handle — on the left edge of the entire sidebar ═══════ */}
      {activePanel && (
        <div
className='absolute top-0 bottom-0 -left-1.5 w-3 cursor-col-resize z-20 group/resize'
          onMouseDown={handleResizeMouseDown}
          onMouseEnter={() => setIsHoveringResize(true)}
          onMouseLeave={() => setIsHoveringResize(false)}
        >
          {/* Small floating stick indicator (like a scrollbar thumb) */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ${
              isHoveringResize || isDraggingState
                ? 'h-12 bg-accent/70'
                : 'h-8 bg-surface-600/60 group-hover/resize:h-10 group-hover/resize:bg-surface-500/80'
            }`}
          />
        </div>
      )}

      {/* ═══════ Icon Rail ═══════ */}
      <div className="w-12 bg-surface-900/90 flex flex-col items-center pt-2 shrink-0 border-l border-surface-800/60">
        {RAIL_ITEMS.map((item) => {
          const isActive = activePanel === item.id
          const badge = badgeCounts[item.id]
          return (
            <button
              key={item.id}
              onClick={() => handleIconClick(item.id)}
              className={`
                relative w-9 h-9 flex items-center justify-center rounded-lg mb-1 transition-colors
                ${isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-800/60'
                }
              `}
              title={item.label}
              aria-label={item.label}
              aria-pressed={isActive}
            >
              {item.icon}
              {/* Badge count */}
              {badge !== undefined && badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono font-bold text-accent bg-accent/10 rounded-full min-w-[16px] h-4 flex items-center justify-center border border-accent/20 px-0.5">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
              )}
            </button>
          )
        })}
      </div>

      {/* ═══════ Content Panel ═══════ */}
      {activePanel && (
        <aside
          className="h-full flex flex-col shrink-0 bg-surface-950 relative"
          style={{ width: `${width}px` }}
          role="complementary"
          aria-label={`${activePanel} panel`}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-surface-800/60 bg-surface-900/70 shrink-0">
            <div className="flex items-center gap-2">
              {/* Show the matching icon small */}
              {RAIL_ITEMS.find((i) => i.id === activePanel)?.icon && (
                <span className="text-text-muted scale-75 origin-left">
                  {RAIL_ITEMS.find((i) => i.id === activePanel)!.icon}
                </span>
              )}
              <span className="text-[12px] font-mono font-medium text-text-secondary">
                {RAIL_ITEMS.find((i) => i.id === activePanel)?.label ?? activePanel}
              </span>
              {/* Diff count badge */}
              {activePanel === 'diff' && diffCount > 0 && (
                <span className="text-[10px] font-mono text-text-tertiary bg-surface-800/60 px-1.5 py-0.5 rounded">
                  {diffCount} file{diffCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={() => setRightSidebarPanel(null)}
              className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-surface-800/50 text-text-tertiary hover:text-text-secondary transition-colors"
              title="Close panel (Escape)"
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activePanel === 'diff' && (
              <DiffPanel diffEntries={diffEntries} selectedId={selectedToolCallId} />
            )}
            {activePanel === 'outline' && <OutlinePanel />}
          </div>
        </aside>
      )}
    </div>
  )
}
