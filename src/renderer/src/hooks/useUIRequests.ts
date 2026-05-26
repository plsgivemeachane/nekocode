import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIRequest } from '../../../shared/ipc-types'
import { createLogger } from '../utils/logger'

const logger = createLogger('useUIRequests')

/** A pending UI request that needs user interaction */
export interface PendingUIRequest {
  /** The original UI request from the extension/workflow */
  request: UIRequest
  /** Local state for the dialog (e.g., selected option, input text) */
  localState: UIDialogLocalState
}

/** Local state for each dialog type */
export interface UIDialogLocalState {
  /** For 'select': index of the highlighted option (-1 = none) */
  highlightedIndex: number
  /** For 'input': current text value */
  inputValue: string
}

export interface UseUIRequestsReturn {
  /** Currently active UI request (null if none) */
  activeRequest: PendingUIRequest | null
  /** Update the local state of the active dialog */
  updateLocalState: (patch: Partial<UIDialogLocalState>) => void
  /** Respond to the active UI request (confirm) */
  confirm: (selectedValue?: string, inputValue?: string) => void
  /** Respond to the active UI request (cancel) */
  cancel: () => void
}

/**
 * Manages UI requests from extensions/workflows.
 * Listens for ui_request events via the preload bridge,
 * stores the active request, and provides methods to respond.
 *
 * IMPORTANT: The listener is registered in a useEffect with proper cleanup
 * to avoid stale closures over sessionId and to clean up on unmount.
 * Previously, registration was done during render (outside useEffect), which
 * caused stale sessionId in the callback closure and no cleanup on unmount.
 */
export function useUIRequests(sessionId: string | null): UseUIRequestsReturn {
  const [activeRequest, setActiveRequest] = useState<PendingUIRequest | null>(null)
  const requestIdRef = useRef<string | null>(null)

  // Use a ref to hold the current sessionId so the callback always sees the latest value
  // (avoids stale closure over sessionId)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  // Subscribe to UI requests from the preload bridge via useEffect for proper cleanup.
  // This fixes a critical bug where the listener was registered during render (outside
  // useEffect), which caused:
  // 1. Stale closure over sessionId — if the session changed, the old sessionId was
  //    captured and new requests for the new session were silently dropped
  // 2. No cleanup on unmount — the IPC listener persisted after the component unmounted,
  //    potentially causing duplicate handlers or memory leaks
  // 3. React strict mode issues — the listener was not properly cleaned up between
  //    the double-mount lifecycle
  useEffect(() => {
    if (!sessionId) {
      logger.debug('useUIRequests: no sessionId, skipping listener registration')
      return
    }

    logger.info(`useUIRequests: registering onUIRequest listener for session ${sessionId}`)

    const unsub = window.nekocode.session.onUIRequest((request: UIRequest) => {
      // Always read from the ref to get the current sessionId
      const currentSessionId = sessionIdRef.current

      // Only handle requests for the current session
      if (request.sessionId !== currentSessionId) {
        logger.debug(
          `useUIRequests: ignoring ui_request for session ${request.sessionId} (current: ${currentSessionId})`
        )
        return
      }

      // Ignore if we already have an active request (shouldn't happen, but defensive)
      if (requestIdRef.current) {
        logger.warn(`Received ui_request ${request.id} while ${requestIdRef.current} is still pending — ignoring`)
        return
      }

      logger.info(`Received ui_request: type=${request.type}, title="${request.title}", id=${request.id}`)
      requestIdRef.current = request.id
      setActiveRequest({
        request,
        localState: {
          highlightedIndex: -1,
          inputValue: request.defaultValue ?? '',
        },
      })
    })

    return () => {
      logger.info(`useUIRequests: cleaning up onUIRequest listener for session ${sessionId}`)
      unsub()
    }
  }, [sessionId])

  // Clear active request when sessionId becomes null
  useEffect(() => {
    if (!sessionId) {
      requestIdRef.current = null
      setActiveRequest(null)
    }
  }, [sessionId])
  const updateLocalState = useCallback((patch: Partial<UIDialogLocalState>) => {
    setActiveRequest(prev => {
      if (!prev) return prev
      return { ...prev, localState: { ...prev.localState, ...patch } }
    })
  }, [])

  const clearRequest = useCallback(() => {
    requestIdRef.current = null
    setActiveRequest(null)
  }, [])

  const confirm = useCallback((selectedValue?: string, inputValue?: string) => {
    const req = activeRequest
    if (!req) return

    logger.info(`Responding to ui_request ${req.request.id}: confirmed=true`)
    window.nekocode.session.uiRespond({
      requestId: req.request.id,
      sessionId: req.request.sessionId,
      confirmed: true,
      selectedValue,
      inputValue,
    })
    clearRequest()
  }, [activeRequest, clearRequest])

  const cancel = useCallback(() => {
    const req = activeRequest
    if (!req) return

    logger.info(`Responding to ui_request ${req.request.id}: confirmed=false (cancelled)`)
    window.nekocode.session.uiRespond({
      requestId: req.request.id,
      sessionId: req.request.sessionId,
      confirmed: false,
    })
    clearRequest()
  }, [activeRequest, clearRequest])

  return {
    activeRequest,
    updateLocalState,
    confirm,
    cancel,
  }
}
