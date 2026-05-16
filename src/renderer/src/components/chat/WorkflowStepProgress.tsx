import React from 'react'
import type { TrackedWorkflow } from '../../hooks/useWorkflowSteps'

type StepStatus = 'running' | 'completed' | 'failed' | 'waiting'

/** Status indicator dot for a workflow step */
function StepStatusDot({ status }: { status: StepStatus }) {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-[7px] w-[7px] shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-accent-400" />
        </span>
      )
    case 'completed':
      return <span className="h-[7px] w-[7px] rounded-full bg-success shrink-0" />
    case 'failed':
      return <span className="h-[7px] w-[7px] rounded-full bg-error shrink-0" />
    case 'waiting':
      return <span className="h-[7px] w-[7px] rounded-full bg-text-muted shrink-0" />
  }
}

/** Icon for a completed step */
function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-success shrink-0">
      <path d="M3 8.5l3.5 3L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Icon for a failed step */
function FailIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-error shrink-0">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Icon for a waiting step */
function WaitingIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-text-muted shrink-0">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.7" fill="currentColor" />
    </svg>
  )
}

interface WorkflowStepProgressProps {
  /** The tracked workflow to render */
  workflow: TrackedWorkflow
}

/**
 * Renders workflow step progress as an inline block in the chat timeline.
 * Shows each step with its status, name, and optional detail.
 * Matches the visual style of ToolCallGroup and ThinkingBlock.
 */
export function WorkflowStepProgress({ workflow }: WorkflowStepProgressProps) {
  // Build an ordered array of steps from the map
  const steps: Array<{ index: number; status: StepStatus; name: string; detail?: string }> = []
  for (let i = 0; i < workflow.totalSteps; i++) {
    const event = workflow.steps.get(i)
    steps.push({
      index: i,
      status: event?.status ?? 'waiting',
      name: event?.stepName ?? `Step ${i + 1}`,
      detail: event?.detail,
    })
  }

  const completedCount = steps.filter(s => s.status === 'completed').length
  const failedCount = steps.filter(s => s.status === 'failed').length
  const runningCount = steps.filter(s => s.status === 'running').length
  const progressPercent = workflow.totalSteps > 0
    ? Math.round((completedCount / workflow.totalSteps) * 100)
    : 0

  return (
    <div className="rounded-lg border border-surface-800/80 bg-surface-900/50 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-[5px] border-b border-surface-800/60 bg-surface-900/70">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-text-muted">
          <path d="M2 2h2v2H2zM8 2h2v2H8zM2 8h2v2H2zM5 5h2v2H5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        <span className="text-[12px] font-mono text-text-secondary">{workflow.workflowName}</span>
        {workflow.isActive && (
          <span className="text-[11px] font-mono text-accent-400">{runningCount} running</span>
        )}
        {!workflow.isActive && failedCount > 0 && (
          <span className="text-[11px] font-mono text-error">{failedCount} failed</span>
        )}
        {!workflow.isActive && failedCount === 0 && completedCount === workflow.totalSteps && (
          <span className="text-[11px] font-mono text-success">done</span>
        )}
        <span className="ml-auto text-[11px] font-mono text-text-muted">{completedCount}/{workflow.totalSteps}</span>
      </div>

      {/* Progress bar */}
      {workflow.totalSteps > 1 && (
        <div className="h-[2px] bg-surface-800/60">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              failedCount > 0 && !workflow.isActive
                ? 'bg-error'
                : 'bg-accent-400'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Steps list */}
      <div className="divide-y divide-surface-800/40">
        {steps.map(step => (
          <div
            key={step.index}
            className={`flex items-center gap-2.5 px-3.5 py-[5px] transition-colors ${
              step.status === 'running' ? 'bg-accent-400/5' : ''
            }`}
          >
            {step.status === 'completed' ? (
              <CheckIcon />
            ) : step.status === 'failed' ? (
              <FailIcon />
            ) : step.status === 'running' ? (
              <StepStatusDot status="running" />
            ) : (
              <WaitingIcon />
            )}
            <span className={`text-[12px] font-mono w-[88px] shrink-0 truncate ${
              step.status === 'running'
                ? 'text-text-primary font-medium'
                : step.status === 'failed'
                  ? 'text-error'
                  : step.status === 'completed'
                    ? 'text-text-secondary'
                    : 'text-text-muted'
            }`}>
              {step.name}
            </span>
            {step.detail && (
              <span className="text-[12px] font-mono text-text-tertiary truncate">{step.detail}</span>
            )}
            {step.status === 'waiting' && !step.detail && (
              <span className="text-[12px] font-mono text-text-muted italic">pending</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
