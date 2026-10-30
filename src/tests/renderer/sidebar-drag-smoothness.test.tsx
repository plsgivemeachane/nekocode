// @vitest-environment jsdom
/**
 * Sidebar drag smoothness — feedback loop for the "left sidebar is not as
 * smooth as the right sidebar" bug.
 *
 * Both sidebars implement resize the same way: on each document `mousemove`
 * during a drag they call setState, which re-renders the whole sidebar
 * component. The per-mousemove React commit must stay well under one frame
 * (16.7ms) or the drag stutters.
 *
 * The loop: simulate a drag (mousedown on the resize handle + 30 mousemove
 * events), time each mousemove's React commit, and assert the p95 stays under
 * the frame budget proxy (8ms). The right sidebar is the known-"smooth"
 * baseline and is measured with the same helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import React from "react"

// ── Mock SessionDiffView (virtualized list — keep the diff panel light,
//    matching production where react-virtuoso only mounts visible rows) ──
vi.mock("@/renderer/src/components/chat/SessionDiffView", () => ({
  SessionDiffView: () => <div data-testid="session-diff-view" />,
}))

// ── Mock project-store: mutable state shared by both sidebars ──────────
// NOTE: actions must be STABLE function identities across useProjectStore
// calls — TreeSidebar's SidebarBody memo relies on stable callback props.
// Fresh vi.fn()s per call would break the memo boundary and hide the fix.
const mockSetLeftSidebarWidth = vi.fn()
const mockSetRightSidebarWidth = vi.fn()
const mockSetRightSidebarPanel = vi.fn()
const stableActions = {
  addProject: vi.fn(),
  removeProject: vi.fn(),
  reconnectSession: vi.fn(),
  createSession: vi.fn(),
  refreshSessions: vi.fn(),
  refreshSessionMessages: vi.fn(),
  preloadSession: vi.fn(),
  setActiveSession: vi.fn(),
  setActiveView: vi.fn(),
  setLeftSidebarWidth: mockSetLeftSidebarWidth,
  setRightSidebarPanel: mockSetRightSidebarPanel,
  setRightSidebarWidth: mockSetRightSidebarWidth,
}

type MockStoreState = {
  projects: { id: string; path: string; sessions: { id: string; firstMessage?: string }[] }[]
  activeSessionId: string | null
  activeProjectPath: string
  sessionStatuses: Record<string, string>
  sessionErrorMessages: Record<string, string>
  agentReady: boolean
  activeView: string
  leftSidebarWidth: number
  rightSidebarWidth: number
  rightSidebarActivePanel: string | null
  rightSidebarSelectedToolCallId: string | null
}

let mockStoreState: MockStoreState

vi.mock("@/renderer/src/stores/project-store", () => ({
  useProjectStore: () => ({
    state: mockStoreState,
    ...stableActions,
  }),
}))

// ── Mock session-messages-context (used by RightSidebar only) ─────────
vi.mock("@/renderer/src/contexts/session-messages-context", () => ({
  useSessionMessages: () => ({
    messages: [],
    registerToolCallClickHandler: vi.fn(),
  }),
}))

import { TreeSidebar } from "@/renderer/src/components/layout/TreeSidebar"
import { RightSidebar } from "@/renderer/src/components/layout/RightSidebar"

// ── Helpers ───────────────────────────────────────────────────────────
function makeFixture(projects: number, sessionsPerProject: number) {
  const projectsFixture = Array.from({ length: projects }, (_, i) => ({
    id: `proj-${i}`,
    path: `/workspace/project-${i}`,
    sessions: Array.from({ length: sessionsPerProject }, (_, j) => ({
      id: `sess-${i}-${j}`,
      firstMessage: `Session ${i}-${j} message`,
    })),
  }))
  return projectsFixture
}

function setupWindow() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (!w.nekocode) w.nekocode = {}
  w.nekocode.shell = {
    openInVscode: vi.fn().mockResolvedValue(true),
    openInExplorer: vi.fn().mockResolvedValue(true),
    checkVscodeAvailable: vi.fn().mockResolvedValue({ available: true }),
  }
  w.nekocode.dialog = { openFolder: vi.fn().mockResolvedValue(null) }
}

/**
 * Simulate a drag on the given resize handle and return the per-mousemove
 * React commit durations in ms. Each mousemove is timed separately so we can
 * see the p95 cost of a single frame of dragging.
 */
function timeDrag(steps = 30): number[] {
  const handle = document.querySelector('[class*="cursor-col-resize"]')
  expect(handle).not.toBeNull()
  fireEvent.mouseDown(handle as Element, { clientX: 220 })

  const durations: number[] = []
  for (let i = 1; i <= steps; i++) {
    const start = performance.now()
    fireEvent.mouseMove(document, { clientX: 220 + i * 4 })
    durations.push(performance.now() - start)
  }
  fireEvent.mouseUp(document)
  return durations
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(0.95 * sorted.length)] ?? sorted[sorted.length - 1]
}

// ── Tests ─────────────────────────────────────────────────────────────
describe("sidebar drag smoothness", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupWindow()
    mockStoreState = {
      projects: makeFixture(6, 6),
      activeSessionId: null,
      activeProjectPath: "/workspace/project-0",
      sessionStatuses: {},
      sessionErrorMessages: {},
      agentReady: true,
      activeView: "chat",
      leftSidebarWidth: 260,
      rightSidebarWidth: 480,
      rightSidebarActivePanel: "diff",
      rightSidebarSelectedToolCallId: null,
    }
  })

  it("left (TreeSidebar) mousemove commit stays under frame budget", () => {
    render(<TreeSidebar />)
    // Let the auto-expand effect run so all session rows are mounted
    const durations = timeDrag()
    const ninetyFifth = p95(durations)
    console.log(`[left]  p95 mousemove commit: ${ninetyFifth.toFixed(2)}ms (max ${Math.max(...durations).toFixed(2)}ms, n=${durations.length})`)
    expect(ninetyFifth).toBeLessThan(8)
  })

  it("right (RightSidebar) mousemove commit stays under frame budget (baseline)", () => {
    render(<RightSidebar />)
    const durations = timeDrag()
    const ninetyFifth = p95(durations)
    console.log(`[right] p95 mousemove commit: ${ninetyFifth.toFixed(2)}ms (max ${Math.max(...durations).toFixed(2)}ms, n=${durations.length})`)
    expect(ninetyFifth).toBeLessThan(8)
  })
})
