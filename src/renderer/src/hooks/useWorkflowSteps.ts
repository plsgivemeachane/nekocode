import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkflowStepEvent } from '../../../shared/ipc-types'
import { createLogger } from '../utils/logger'

const logger = createLogger('useWorkflowSteps')

/** A tracked workflow with its step history */
export interface TrackedWorkflow {
  /** Unique workflow execution ID */
  workflowId: string
  /** Human-readable workflow name */
  workflowName: string
  /** The session this workflow belongs to */
  sessionId: string
  /** All step events received so far, keyed by stepIndex */
  steps: Map<number, WorkflowStepEvent>
  /** Total steps (may update as workflow progresses) */
  totalSteps: number
  /** Whether the workflow is still active (not all steps completed/failed) */
  isActive: boolean
}

export interface UseWorkflowStepsReturn {
  /** Currently active workflows keyed by workflowId */
  workflows: Map<string, TrackedWorkflow>
  /** Get a workflow by ID */
  getWorkflow: (workflowId: string) => TrackedWorkflow | undefined
  /** Get the most recently active workflow */
  getActiveWorkflow: () => TrackedWorkflow | undefined
}

/**
 * Tracks workflow step progress events streamed from the main process.
 * Listens for workflow_step events and maintains a map of active workflows.
 */
export function useWorkflowSteps(sessionId: string | null): UseWorkflowStepsReturn {
  const [workflows, setWorkflows] = useState<Map<string, TrackedWorkflow>>(new Map())
  const workflowsRef = useRef<Map<string, TrackedWorkflow>>(new Map())
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!sessionId) {
      // Clean up when session changes away
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
      setWorkflows(new Map())
      workflowsRef.current = new Map()
      return
    }

    // Subscribe to session events and filter for workflow_step
    const unsub = window.nekocode.session.onEvent((payload) => {
      if (payload.sessionId !== sessionId) return
      const event = payload.event
      if (event.type !== 'workflow_step') return

      const step: WorkflowStepEvent = event.step
      logger.debug(`workflow_step: ${step.workflowName} step ${step.stepIndex + 1}/${step.totalSteps} "${step.stepName}" [${step.status}]`)

      // Update the workflows map immutably
      setWorkflows(prev => {
        const next = new Map(prev)
        const existing = next.get(step.workflowId)

        if (existing) {
          // Update existing workflow
          const newSteps = new Map(existing.steps)
          newSteps.set(step.stepIndex, step)
          const isActive = step.status === 'running' || step.status === 'waiting'
          next.set(step.workflowId, {
            ...existing,
            steps: newSteps,
            totalSteps: Math.max(existing.totalSteps, step.totalSteps),
            isActive,
          })
        } else {
          // New workflow
          const newSteps = new Map<number, WorkflowStepEvent>()
          newSteps.set(step.stepIndex, step)
          const isActive = step.status === 'running' || step.status === 'waiting'
          next.set(step.workflowId, {
            workflowId: step.workflowId,
            workflowName: step.workflowName,
            sessionId: step.sessionId,
            steps: newSteps,
            totalSteps: step.totalSteps,
            isActive,
          })
        }

        // Keep ref in sync for non-reactive access
        workflowsRef.current = next
        return next
      })
    })

    unsubRef.current = unsub

    return () => {
      unsub()
      unsubRef.current = null
    }
  }, [sessionId])

  const getWorkflow = useCallback((workflowId: string) => {
    return workflowsRef.current.get(workflowId)
  }, [])

  const getActiveWorkflow = useCallback(() => {
    // Return the most recently updated active workflow
    let latest: TrackedWorkflow | undefined
    for (const wf of workflowsRef.current.values()) {
      if (wf.isActive) {
        if (!latest || wf.workflowId > latest.workflowId) {
          latest = wf
        }
      }
    }
    return latest
  }, [])

  return { workflows, getWorkflow, getActiveWorkflow }
}
