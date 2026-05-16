import { useCallback, useRef, useState } from 'react'
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
 */
export function useUIRequests(sessionId: string | null): UseUIRequestsReturn {
  const [activeRequest, setActiveRequest] = useState<PendingUIRequest | null>(null)
  const requestIdRef = useRef<string | null>(null)

  // Subscribe to UI requests from the preload bridge
  // We use a separate effect that directly uses onUIRequest
  // so we don't couple this to the message event stream.
  const unsubRef = useRef<(() => void) | null>(null)

  // Set up / tear down the listener when sessionId changes
  if (sessionId && !unsubRef.current) {
    unsubRef.current = window.nekocode.session.onUIRequest((request: UIRequest) => {
      // Only handle requests for the current session
      if (request.sessionId !== sessionId) return

      // Ignore if we already have an active request (shouldn't happen, but defensive)
      if (requestIdRef.current) {
        logger.warn(`Received ui_request ${request.id} while ${requestIdRef.current} is still pending — ignoring`)
        return
      }

      logger.info(`Received ui_request: type=${request.type}, title="${request.title}"`)
      requestIdRef.current = request.id
      setActiveRequest({
        request,
        localState: {
          highlightedIndex: -1,
          inputValue: request.defaultValue ?? '',
        },
      })
    })
  }

  // Clean up listener when sessionId becomes null
  if (!sessionId && unsubRef.current) {
    unsubRef.current()
    unsubRef.current = null
    requestIdRef.current = null
    setActiveRequest(null)
  }

  // Clean up on unmount
  // (React strict mode double-mount is handled by the null-check above)
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
