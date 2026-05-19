// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { WorkflowStepProgress } from "@/renderer/src/components/chat/WorkflowStepProgress"
import type { TrackedWorkflow } from "@/renderer/src/hooks/useWorkflowSteps"
import type { WorkflowStepEvent } from "@/shared/ipc-types"

// ── Helpers ──────────────────────────────────────────────────────────

function makeStep(overrides: Partial<WorkflowStepEvent> = {}): WorkflowStepEvent {
  return {
    sessionId: "sess-1",
    workflowId: "wf-1",
    workflowName: "Test Workflow",
    stepIndex: 0,
    totalSteps: 3,
    stepName: "Step 0",
    status: "completed",
    ...overrides,
  }
}

function makeWorkflow(overrides: Partial<TrackedWorkflow> = {}): TrackedWorkflow {
  const steps = new Map<number, WorkflowStepEvent>()
  steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "completed" }))
  steps.set(1, makeStep({ stepIndex: 1, stepName: "Build", status: "running" }))
  steps.set(2, makeStep({ stepIndex: 2, stepName: "Deploy", status: "waiting" }))

  return {
    workflowId: "wf-1",
    workflowName: "Test Workflow",
    sessionId: "sess-1",
    steps,
    totalSteps: 3,
    isActive: true,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("WorkflowStepProgress", () => {
  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders workflow name in header", () => {
    render(<WorkflowStepProgress workflow={makeWorkflow()} />)
    expect(screen.getByText("Test Workflow")).toBeTruthy()
  })

  it("renders step progress (X/Y) in header", () => {
    render(<WorkflowStepProgress workflow={makeWorkflow()} />)
    // 1 completed out of 3 total = "1/3"
    expect(screen.getByText("1/3")).toBeTruthy()
  })

  it("renders each step name", () => {
    render(<WorkflowStepProgress workflow={makeWorkflow()} />)
    expect(screen.getByText("Setup")).toBeTruthy()
    expect(screen.getByText("Build")).toBeTruthy()
    expect(screen.getByText("Deploy")).toBeTruthy()
  })

  it("renders step detail when present", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "completed", detail: "Installed deps" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1 })
    render(<WorkflowStepProgress workflow={workflow} />)
    expect(screen.getByText("Installed deps")).toBeTruthy()
  })

  it("does not render detail when absent", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "completed" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1 })
    render(<WorkflowStepProgress workflow={workflow} />)
    expect(screen.queryByText("Installed deps")).toBeNull()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Step Status Indicators
  // ═══════════════════════════════════════════════════════════════════

  it("shows running indicator (animate-ping) for running steps", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Build", status: "running" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1 })
    const { container } = render(<WorkflowStepProgress workflow={workflow} />)
    const ping = container.querySelector(".animate-ping")
    expect(ping).toBeTruthy()
  })

  it("shows completed indicator (CheckIcon with text-success) for completed steps", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "completed" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1 })
    const { container } = render(<WorkflowStepProgress workflow={workflow} />)
    // Completed steps show a CheckIcon SVG with text-success class
    const checkIcon = container.querySelector("svg.text-success")
    expect(checkIcon).toBeTruthy()
  })

  it("shows failed indicator (FailIcon with text-error) for failed steps", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Deploy", status: "failed" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1, isActive: false })
    const { container } = render(<WorkflowStepProgress workflow={workflow} />)
    // Failed steps show a FailIcon SVG with text-error class
    const failIcon = container.querySelector("svg.text-error")
    expect(failIcon).toBeTruthy()
  })

  it("shows waiting indicator (WaitingIcon with text-text-muted) for waiting steps", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Deploy", status: "waiting" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1 })
    const { container } = render(<WorkflowStepProgress workflow={workflow} />)
    // Waiting steps show a WaitingIcon SVG with text-text-muted class
    const waitingIcon = container.querySelector("svg.text-text-muted")
    expect(waitingIcon).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Progress Calculation
  // ═══════════════════════════════════════════════════════════════════

  it("shows 0/3 when no steps are completed", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "waiting" }))
    steps.set(1, makeStep({ stepIndex: 1, stepName: "Build", status: "waiting" }))
    steps.set(2, makeStep({ stepIndex: 2, stepName: "Deploy", status: "waiting" }))
    const workflow = makeWorkflow({ steps, totalSteps: 3, isActive: false })
    render(<WorkflowStepProgress workflow={workflow} />)
    // When not active and no steps completed, shows 0/3
    expect(screen.getByText("0/3")).toBeTruthy()
  })

  it("shows 3/3 when all steps are completed", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "completed" }))
    steps.set(1, makeStep({ stepIndex: 1, stepName: "Build", status: "completed" }))
    steps.set(2, makeStep({ stepIndex: 2, stepName: "Deploy", status: "completed" }))
    const workflow = makeWorkflow({ steps, totalSteps: 3, isActive: false })
    render(<WorkflowStepProgress workflow={workflow} />)
    expect(screen.getByText("3/3")).toBeTruthy()
  })

  it("only counts completed steps in progress (not failed)", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Setup", status: "completed" }))
    steps.set(1, makeStep({ stepIndex: 1, stepName: "Build", status: "failed" }))
    steps.set(2, makeStep({ stepIndex: 2, stepName: "Deploy", status: "waiting" }))
    const workflow = makeWorkflow({ steps, totalSteps: 3 })
    render(<WorkflowStepProgress workflow={workflow} />)
    // Progress only counts completed, not failed
    expect(screen.getByText("1/3")).toBeTruthy()
    // Failed step should show failed count
    expect(screen.getByText("0 running")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════

  it("handles single-step workflow", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Only Step", status: "running" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1 })
    render(<WorkflowStepProgress workflow={workflow} />)
    expect(screen.getByText("Only Step")).toBeTruthy()
    expect(screen.getByText("0/1")).toBeTruthy()
  })

  it("handles inactive (completed) workflow", () => {
    const steps = new Map<number, WorkflowStepEvent>()
    steps.set(0, makeStep({ stepIndex: 0, stepName: "Done", status: "completed" }))
    const workflow = makeWorkflow({ steps, totalSteps: 1, isActive: false })
    const { container } = render(<WorkflowStepProgress workflow={workflow} />)
    // No running indicator should be present
    expect(container.querySelector(".animate-ping")).toBeNull()
  })
})
