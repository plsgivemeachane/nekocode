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

import type { ExtensionUIDialogOptions, ExtensionWidgetOptions, WorkingIndicatorOptions, AutocompleteProviderFactory } from '@earendil-works/pi-coding-agent'
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
   * Set the terminal window/tab title.
   * Not applicable for Electron mode — the BrowserWindow title is managed separately.
   *
   * BUG FIX: Previously missing, causing coms extension's session_start handler to
   * throw TypeError and bail out before registering as a peer. Extensions call
   * ctx.ui.setTitle() via applyExtensionDefaults() in their session_start hooks.
   */
  setTitle(title: string): void {
    logger.debug(`[UI setTitle] ${title} — not applicable in Electron mode, ignoring`)
    // Electron BrowserWindow title is managed by the app, not by extensions
  }

  /**
   * Set the current theme by name or Theme object.
   * Not fully applicable for Electron mode — theme is managed by the renderer.
   *
   * BUG FIX: Previously missing, causing coms extension's session_start handler to
   * throw TypeError ("setTheme is not a function") and bail out before registering
   * as a peer. Extensions call ctx.ui.setTheme() via applyExtensionTheme() in
   * their session_start hooks. Without this method, the entire coms peer
   * registration flow was skipped silently.
   */
  setTheme(theme: string): { success: boolean; error?: string } {
    logger.debug(`[UI setTheme] ${theme} — not applicable in Electron mode, returning success`)
    // Return success so extensions don't fall back to alternate themes
    return { success: true }
  }

  /**
   * Get the current theme for styling.
   * Returns undefined in Electron mode — theme is managed by the renderer.
   */
  get theme(): unknown {
    return undefined
  }

  /**
   * Get all available themes. Returns empty in Electron mode.
   */
  getAllThemes(): { name: string; path: string | undefined }[] {
    return []
  }

  /**
   * Load a theme by name without switching to it. Returns undefined in Electron mode.
   */
  getTheme(_name: string): unknown {
    return undefined
  }

  /**
   * Set the working/loading message shown during streaming.
   * Logs in Electron mode — could forward to renderer in the future.
   */
  setWorkingMessage(message?: string): void {
    logger.debug(`[UI setWorkingMessage] ${message ?? '(cleared)'}`)
  }

  /**
   * Show or hide the built-in working loader row during streaming.
   * Not applicable for Electron mode.
   */
  setWorkingVisible(_visible: boolean): void {
    // No-op — Electron manages its own loading indicators
  }

  /**
   * Configure the interactive working indicator shown during streaming.
   * Not applicable for Electron mode.
   */
  setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
    // No-op — Electron manages its own loading indicators
  }

  /**
   * Set the label shown for hidden thinking blocks.
   * Not applicable for Electron mode.
   */
  setHiddenThinkingLabel(_label?: string): void {
    // No-op — Electron manages its own thinking block display
  }

  /**
   * Set a widget to display above or below the editor.
   * Not applicable for Electron mode — no TUI widget system.
   */
  setWidget(_key: string, _content: string[] | undefined, _options?: ExtensionWidgetOptions): void {
    // No-op — Electron doesn't have TUI widgets
  }

  /**
   * Set a custom footer component. Not applicable for Electron mode.
   */
  setFooter(_factory: unknown): void {
    // No-op — Electron has its own footer
  }

  /**
   * Set a custom header component. Not applicable for Electron mode.
   */
  setHeader(_factory: unknown): void {
    // No-op — Electron has its own header
  }

  /**
   * Show a custom component with keyboard focus. Not applicable for Electron mode.
   */
  async custom<T>(_factory: unknown): Promise<T> {
    return undefined as unknown as T
  }

  /**
   * Paste text into the editor. Not applicable for Electron mode.
   */
  pasteToEditor(_text: string): void {
    // No-op — Electron manages its own input
  }

  /**
   * Set the text in the core input editor. Not applicable for Electron mode.
   */
  setEditorText(_text: string): void {
    // No-op — Electron manages its own input
  }

  /**
   * Get the current text from the core input editor. Not applicable for Electron mode.
   */
  getEditorText(): string {
    return ''
  }

  /**
   * Show a multi-line editor for text editing.
   * Falls back to the input dialog in Electron mode.
   */
  async editor(title: string, prefill?: string): Promise<string | undefined> {
    return this.input(title, prefill)
  }

  /**
   * Stack additional autocomplete behavior. Not applicable for Electron mode.
   */
  addAutocompleteProvider(_factory: AutocompleteProviderFactory): void {
    // No-op — Electron manages its own autocomplete
  }

  /**
   * Set a custom editor component. Not applicable for Electron mode.
   */
  setEditorComponent(_factory: unknown): void {
    // No-op — Electron manages its own editor component
  }

  /**
   * Get the currently configured custom editor factory.
   */
  getEditorComponent(): unknown {
    return undefined
  }

  /**
   * Get current tool output expansion state.
   */
  getToolsExpanded(): boolean {
    return false
  }

  /**
   * Set tool output expansion state.
   */
  setToolsExpanded(_expanded: boolean): void {
    // No-op — could forward to renderer in the future
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
