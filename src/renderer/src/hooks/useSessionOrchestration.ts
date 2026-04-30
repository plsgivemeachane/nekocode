import { useCallback, useRef } from 'react'
import type { ProjectAction } from '../stores/project-store'
import type { Dispatch } from 'react'
import { createLogger } from '../logger'
import { logExtensionLoadWarnings } from '../utils/extension-logging'

const logger = createLogger('useSessionOrchestration')

interface UseSessionOrchestrationOptions {
  dispatch: Dispatch<ProjectAction>
  activeSessionId: string | null
  activeProjectPath: string | null
}

export function useSessionOrchestration({
  dispatch,
  activeSessionId,
  activeProjectPath,
}: UseSessionOrchestrationOptions) {
  // Tracks sessions created in this runtime that are still true empty drafts.
  const draftSessionsRef = useRef<Map<string, string>>(new Map())
  // Prevent duplicate session creation from rapid repeated clicks.
  const createInFlightProjectsRef = useRef<Set<string>>(new Set())

  const reconnectSession = useCallback(
    async (sessionId: string, projectPath: string) => {
      // Set active session immediately with "connecting" status
      dispatch({ type: 'SET_ACTIVE_SESSION', sessionId, projectPath })
      dispatch({ type: 'SET_AGENT_CONNECTING' })

      try {
        const wasRuntimeDraft = draftSessionsRef.current.get(sessionId) === projectPath
        const result = await window.nekocode.session.reconnect(sessionId, projectPath)
        logExtensionLoadWarnings('reconnect', sessionId, result.extensionErrors, result.extensionsDisabled, (sid) => {
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId: sid, status: 'error' })
        })
        dispatch({ type: 'SET_SESSION_MESSAGE_COUNT', sessionId, messageCount: result.history.length })
        if (result.history.length > 0) {
          draftSessionsRef.current.delete(sessionId)
        } else if (wasRuntimeDraft) {
          draftSessionsRef.current.set(sessionId, projectPath)
        }
        logger.info(`reconnectSession OK: ${sessionId.slice(0, 8)}...`)
        dispatch({ type: 'SET_AGENT_READY', sessionId })
      } catch (err) {
        logger.error('reconnectSession failed:', err)
        dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
        dispatch({ type: 'SET_AGENT_READY', sessionId })
      }
    },
    [dispatch],
  )

  const createSession = useCallback(
    async (projectPath: string) => {
      if (createInFlightProjectsRef.current.has(projectPath)) {
        logger.debug(`createSession skipped: already in flight for cwd=${projectPath}`)
        return
      }
      createInFlightProjectsRef.current.add(projectPath)
      try {
        // Reuse only the currently active draft session that was created in this runtime.
        const isActiveDraft =
          activeSessionId != null &&
          activeProjectPath === projectPath &&
          draftSessionsRef.current.get(activeSessionId) === projectPath

        if (isActiveDraft && activeSessionId) {
          try {
            const history = await window.nekocode.session.loadHistory(activeSessionId)
            dispatch({ type: 'SET_SESSION_MESSAGE_COUNT', sessionId: activeSessionId, messageCount: history.length })
            if (history.length === 0) {
              logger.info(`createSession: reusing active empty draft ${activeSessionId.slice(0, 8)}... cwd=${projectPath}`)
              dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: activeSessionId, projectPath })
              return
            }
            draftSessionsRef.current.delete(activeSessionId)
            logger.info(`createSession: active draft ${activeSessionId.slice(0, 8)}... has ${history.length} message(s), creating fresh session`)
          } catch (err) {
            draftSessionsRef.current.delete(activeSessionId)
            logger.warn(`createSession: failed to verify draft history for ${activeSessionId.slice(0, 8)}..., creating fresh session`, err)
          }
        }

        const result = await window.nekocode.session.create(projectPath)
        logExtensionLoadWarnings('create', result.sessionId, result.extensionErrors, result.extensionsDisabled, (sid) => {
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId: sid, status: 'error' })
        })
        draftSessionsRef.current.set(result.sessionId, projectPath)
        logger.info(`createSession OK: ${result.sessionId.slice(0, 8)}... cwd=${projectPath}`)
        dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: result.sessionId, projectPath })
        dispatch({
          type: 'ADD_SESSION_TO_PROJECT',
          projectPath,
          session: {
            id: result.sessionId,
            firstMessage: 'New session',
            created: new Date().toISOString(),
            messageCount: 0,
          },
        })
      } catch (err) {
        logger.error('createSession failed:', err)
      } finally {
        createInFlightProjectsRef.current.delete(projectPath)
      }
    },
    [dispatch, activeProjectPath, activeSessionId],
  )

  /**
   * Reconnect a session during startup initialization.
   * Used by the init effect in ProjectProvider.
   */
  const initReconnect = useCallback(
    async (sessionId: string, projectPath: string) => {
      dispatch({ type: 'SET_AGENT_CONNECTING' })
      dispatch({ type: 'SET_ACTIVE_SESSION', sessionId, projectPath })
      try {
        const result = await window.nekocode.session.reconnect(sessionId, projectPath)
        logExtensionLoadWarnings('reconnect', sessionId, result.extensionErrors, result.extensionsDisabled, (sid) => {
          dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId: sid, status: 'error' })
        })
        dispatch({ type: 'SET_SESSION_MESSAGE_COUNT', sessionId, messageCount: result.history.length })
        if (result.history.length > 0) {
          dispatch({ type: 'PRELOAD_HISTORY', sessionId, messages: result.history })
        }
        dispatch({ type: 'SET_AGENT_READY', sessionId })
      } catch (err) {
        logger.error('Failed to reconnect restored session', err)
        dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'error' })
        dispatch({ type: 'SET_AGENT_READY', sessionId })
      }
    },
    [dispatch],
  )

  return {
    reconnectSession,
    createSession,
    initReconnect,
    draftSessionsRef,
  }
}
