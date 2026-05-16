/**
 * ElectronUIContext - Implements the Pi SDK ExtensionUIContext interface
 * by forwarding UI requests (select, confirm, input) to the renderer process
 * via IPC and waiting for responses.
 *
 * When an extension calls ui.select(), ui.confirm(), or ui.input(),
 * this class sends a UIRequest event to the renderer, which displays
 * the appropriate dialog. The user's response is sent back via the
 * session:ui-respond IPC channel, resolving the pending promise.
 *
 * Two modes of operation:
 * 1. Main thread mode: sends UI requests directly to BrowserWindow via IPC
 * 2. Worker thread mode: sends UI requests to the main thread via parentPort
 */

import type { ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent'
import type { UIRequest, UIResponse, SessionStreamEvent } from '../shared/ipc-types'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { createLogger } from './logger'

const logger = createLogger('ElectronUIContext')

/**
 * Strategy for sending UI requests out of this context.
 * In main thread: uses BrowserWindow IPC
 * In worker thread: uses parentPort to forward to main thread
 */
export interface UIRequestTransport {
  /** Send a UI request event to the renderer */
  sendUIRequest(sessionId: string, event: SessionStreamEvent): void
}

/**
 * Manages pending UI requests that are waiting for renderer responses.
 * Keyed by request ID for O(1) lookup when the renderer responds.
 */
interface PendingRequest {
  resolve: (value: unknown) => void
  timeoutTimer?: ReturnType<typeof setTimeout>
}

export class ElectronUIContext {
  private sessionId: string
  private transport: UIRequestTransport
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private requestCounter: number = 0

  constructor(sessionId: string, transport: UIRequestTransport) {
    this.sessionId = sessionId
    this.transport = transport
  }

  /**
   * Show a selector dialog and return the user's choice.
   * Sends a UIRequest with type 'select' to the renderer.
   */
  async select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    const requestId = this.generateRequestId()
    const request: UIRequest = {
      id: requestId,
      sessionId: this.sessionId,
      type: 'select',
      title,
      options: options.map(opt => ({
        label: opt,
        value: opt,
      })),
    }

    // If AbortSignal is provided, listen for abort
    if (opts?.signal) {
      opts.signal.addEventListener('abort', () => {
        this.cancelRequest(requestId)
      }, { once: true })
    }

    return this.sendRequestAndWait<string | undefined>(request, opts?.timeout)
  }

  /**
   * Show a confirmation dialog and return the user's choice.
   * Sends a UIRequest with type 'confirm' to the renderer.
   */
  async confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
    const requestId = this.generateRequestId()
    const request: UIRequest = {
      id: requestId,
      sessionId: this.sessionId,
      type: 'confirm',
      title,
      description: message,
    }

    if (opts?.signal) {
      opts.signal.addEventListener('abort', () => {
        this.cancelRequest(requestId)
      }, { once: true })
    }

    return this.sendRequestAndWait<boolean>(request, opts?.timeout)
  }

  /**
   * Show a text input dialog and return the entered text.
   * Sends a UIRequest with type 'input' to the renderer.
   */
  async input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    const requestId = this.generateRequestId()
    const request: UIRequest = {
      id: requestId,
      sessionId: this.sessionId,
      type: 'input',
      title,
      placeholder,
    }

    if (opts?.signal) {
      opts.signal.addEventListener('abort', () => {
        this.cancelRequest(requestId)
      }, { once: true })
    }

    return this.sendRequestAndWait<string | undefined>(request, opts?.timeout)
  }

  /**
   * Show a notification to the user.
   * For Electron, we log it; a proper notification system can be added later.
   */
  notify(message: string, type?: 'info' | 'warning' | 'error'): void {
    logger.info(`[UI notify] [${type ?? 'info'}] ${message}`)
  }

  /**
   * Not applicable for Electron mode - no terminal input.
   */
  onTerminalInput(): () => void {
    logger.debug('onTerminalInput called in Electron mode - not applicable')
    return () => {}
  }

  /**
   * Set status text in the footer/status bar.
   */
  setStatus(key: string, text: string | undefined): void {
    logger.debug(`[UI setStatus] ${key}: ${text ?? '(cleared)'}`)
    // Could forward to renderer status bar in the future
  }

  /**
   * Handle a UI response from the renderer.
   * Called when the renderer sends a uiRespond IPC message.
   */
  handleResponse(response: UIResponse): void {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) {
      logger.warn(`handleResponse: no pending request for ID ${response.requestId}`)
      return
    }

    // Clear timeout if present
    if (pending.timeoutTimer) {
      clearTimeout(pending.timeoutTimer)
    }

    this.pendingRequests.delete(response.requestId)

    // Resolve the promise based on the response type
    switch (response.confirmed) {
      case false:
        // User cancelled - resolve with undefined/false depending on type
        pending.resolve(undefined)
        break
      default:
        // User confirmed - resolve with the appropriate value
        if (response.selectedValue !== undefined) {
          pending.resolve(response.selectedValue)
        } else if (response.inputValue !== undefined) {
          pending.resolve(response.inputValue)
        } else {
          pending.resolve(true) // confirm dialog
        }
        break
    }
  }

  /**
   * Cancel a pending request (e.g. due to AbortSignal).
   */
  private cancelRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return

    if (pending.timeoutTimer) {
      clearTimeout(pending.timeoutTimer)
    }

    this.pendingRequests.delete(requestId)
    pending.resolve(undefined)
  }

  /**
   * Send a UI request to the renderer and wait for the response.
   */
  private sendRequestAndWait<T>(request: UIRequest, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pending: PendingRequest = { resolve: resolve as (value: any) => void }

      // Set up timeout if provided
      if (timeoutMs && timeoutMs > 0) {
        pending.timeoutTimer = setTimeout(() => {
          this.pendingRequests.delete(request.id)
          resolve(undefined as unknown as T)
        }, timeoutMs)
      }

      this.pendingRequests.set(request.id, pending)

      // Send the UI request event via the transport
      this.transport.sendUIRequest(this.sessionId, {
        type: 'ui_request',
        request,
      } as SessionStreamEvent)

      logger.debug(`ElectronUIContext: sent ${request.type} request ${request.id} for session ${this.sessionId}`)
    })
  }

  /**
   * Generate a unique request ID.
   */
  private generateRequestId(): string {
    return `ui-${this.sessionId.slice(0, 8)}-${++this.requestCounter}-${Date.now()}`
  }

  /**
   * Clean up all pending requests (called when session is disposed).
   */
  dispose(): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeoutTimer) {
        clearTimeout(pending.timeoutTimer)
      }
      pending.resolve(undefined)
    }
    this.pendingRequests.clear()
  }
}

// ============================================================================
// Transport Implementations
// ============================================================================

/**
 * Main-thread transport: sends UI requests directly to BrowserWindow via IPC.
 */
export class MainThreadUITransport implements UIRequestTransport {
  sendUIRequest(sessionId: string, event: SessionStreamEvent): void {
    // Lazy require to avoid bundling issues with Electron
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SESSION_EVENTS, {
          sessionId,
          event,
        })
      }
    }
  }
}

/**
 * Worker-thread transport: sends UI requests to the main thread via parentPort.
 * The main thread will forward them to the renderer.
 */
export class WorkerThreadUITransport implements UIRequestTransport {
  sendUIRequest(sessionId: string, event: SessionStreamEvent): void {
    // Lazy require to avoid bundling issues with worker_threads
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parentPort } = require('worker_threads')
    if (parentPort) {
      parentPort.postMessage({
        type: 'session_event',
        sessionId,
        event,
      })
    }
  }
}
