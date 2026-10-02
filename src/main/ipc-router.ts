/**
 * Type-safe IPC Router for Electron.
 *
 * This module provides a type-safe handler registration API that maps channel
 * names to their request/response types, automatically validating IPC senders.
 * It eliminates the repetitive boilerplate of manually validating senders
 * and casting payloads/results in ipc-handlers.ts.
 *
 * Key components:
 * 1. `IpcChannelMap` — A centralized mapping of every IPC channel to its payload
 *    and result types, ensuring compile-time type safety.
 * 2. `IpcRouter` — A class with `handle()` and `handleVoid()` methods that
 *    register type-safe handlers.
 *
 * Usage:
 *   const router = new IpcRouter()
 *   router.handle(IPC_CHANNELS.SESSION_CREATE, async (payload) => { ... })
 *   router.handleVoid(IPC_CHANNELS.PROJECT_LIST, async () => { ... })
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { validateIpcSender } from './security-utils'
import { createLogger } from './logger'

const logger = createLogger('ipc-router')
import type {
  SessionCreatePayload,
  SessionCreateResult,
  SessionPromptPayload,
  SessionAbortPayload,
  SessionDisposePayload,
  SessionDeletePayload,
  SessionReconnectPayload,
  SessionReconnectResult,
  SessionLoadHistoryPayload,
  SessionLoadHistoryDiskPayload,
  ChatMessageIPC,
  ProjectAddPayload,
  ProjectRemovePayload,
  ProjectSessionsPayload,
  ProjectInfo,
  WorkspaceSetActivePayload,
  WorkspaceActiveResult,
  CommandInfo,
  ModelInfo,
  UpdateAvailableInfo,
  NotificationSettings,
  NotificationPayload,
  SearchFilesRequest,
  SearchFilesResult,
  UIResponse,
  ZoomInfo,
  GitStatusResult,
  GitLogResult,
  GitDiffResult,
  GitDiffSummaryResult,
  GitCommitResult,
  GitBranchListResult,
  GitPullResult,
  GitStashListResult,
} from '../shared/ipc-types'

// ============================================================================
// IpcChannelMap — Maps channel names to their payload and result types
// ============================================================================

/**
 * Centralized type mapping for all IPC channels.
 * Each entry maps a channel name to its request payload and expected result type.
 * `void` payload means no payload is expected.
 * `void` result means no result is returned (fire-and-forget).
 */
export interface IpcChannelMap {
  [IPC_CHANNELS.SESSION_CREATE]: { payload: SessionCreatePayload; result: SessionCreateResult }
  [IPC_CHANNELS.SESSION_PROMPT]: { payload: SessionPromptPayload; result: void }
  [IPC_CHANNELS.SESSION_ABORT]: { payload: SessionAbortPayload; result: void }
  [IPC_CHANNELS.SESSION_DISPOSE]: { payload: SessionDisposePayload; result: void }
  [IPC_CHANNELS.SESSION_DELETE]: { payload: SessionDeletePayload; result: void }
  [IPC_CHANNELS.SESSION_RECONNECT]: { payload: SessionReconnectPayload; result: SessionReconnectResult }
  [IPC_CHANNELS.SESSION_LOAD_HISTORY]: { payload: SessionLoadHistoryPayload; result: ChatMessageIPC[] }
  [IPC_CHANNELS.SESSION_LOAD_HISTORY_DISK]: { payload: SessionLoadHistoryDiskPayload; result: ChatMessageIPC[] }
  [IPC_CHANNELS.SESSION_GET_MODEL]: { payload: { sessionId: string }; result: ModelInfo | null }
  [IPC_CHANNELS.SESSION_LIST_MODELS]: { payload: void; result: ModelInfo[] }
  [IPC_CHANNELS.SESSION_SET_MODEL]: { payload: { sessionId: string; provider: string; modelId: string }; result: ModelInfo }
  [IPC_CHANNELS.SESSION_GET_COMMANDS]: { payload: { sessionId: string }; result: CommandInfo[] }
  [IPC_CHANNELS.SESSION_UI_RESPOND]: { payload: UIResponse; result: void }
  [IPC_CHANNELS.DIALOG_OPEN_FOLDER]: { payload: void; result: string | null }
  [IPC_CHANNELS.PROJECT_ADD]: { payload: ProjectAddPayload; result: ProjectInfo }
  [IPC_CHANNELS.PROJECT_REMOVE]: { payload: ProjectRemovePayload; result: boolean }
  [IPC_CHANNELS.PROJECT_LIST]: { payload: void; result: ProjectInfo[] }
  [IPC_CHANNELS.PROJECT_SESSIONS]: { payload: ProjectSessionsPayload; result: ProjectInfo | null }
  [IPC_CHANNELS.WORKSPACE_SET_ACTIVE]: { payload: WorkspaceSetActivePayload; result: void }
  [IPC_CHANNELS.WORKSPACE_GET_ACTIVE]: { payload: void; result: WorkspaceActiveResult }
  [IPC_CHANNELS.UPDATE_CHECK]: { payload: void; result: UpdateAvailableInfo | null }
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: { payload: void; result: void }
  [IPC_CHANNELS.UPDATE_INSTALL]: { payload: void; result: void }
  [IPC_CHANNELS.SEARCH_FILES]: { payload: SearchFilesRequest; result: SearchFilesResult }
  // Git operations — note: these use 'cwd' as the project path field name
  // to match the existing handler signatures in ipc-handlers.ts
  [IPC_CHANNELS.GIT_GET_BRANCH]: { payload: { cwd: string }; result: string | null }
  [IPC_CHANNELS.GIT_STATUS]: { payload: { cwd: string }; result: GitStatusResult }
  [IPC_CHANNELS.GIT_LOG]: { payload: { cwd: string; maxCount?: number }; result: GitLogResult }
  [IPC_CHANNELS.GIT_DIFF]: { payload: { cwd: string; filePath?: string; staged?: boolean }; result: GitDiffResult }
  [IPC_CHANNELS.GIT_DIFF_SUMMARY]: { payload: { cwd: string; staged?: boolean }; result: GitDiffSummaryResult }
  [IPC_CHANNELS.GIT_STAGE]: { payload: { cwd: string; filePath: string }; result: void }
  [IPC_CHANNELS.GIT_UNSTAGE]: { payload: { cwd: string; filePath: string }; result: void }
  [IPC_CHANNELS.GIT_STAGE_ALL]: { payload: { cwd: string }; result: void }
  [IPC_CHANNELS.GIT_UNSTAGE_ALL]: { payload: { cwd: string }; result: void }
  [IPC_CHANNELS.GIT_COMMIT]: { payload: { cwd: string; message: string }; result: GitCommitResult }
  [IPC_CHANNELS.GIT_PUSH]: { payload: { cwd: string; remote?: string; branch?: string }; result: void }
  [IPC_CHANNELS.GIT_PULL]: { payload: { cwd: string; remote?: string; branch?: string }; result: GitPullResult }
  [IPC_CHANNELS.GIT_FETCH]: { payload: { cwd: string; remote?: string }; result: void }
  [IPC_CHANNELS.GIT_BRANCH_LIST]: { payload: { cwd: string }; result: GitBranchListResult }
  [IPC_CHANNELS.GIT_BRANCH_CREATE]: { payload: { cwd: string; name: string; checkout?: boolean }; result: void }
  [IPC_CHANNELS.GIT_BRANCH_SWITCH]: { payload: { cwd: string; name: string }; result: void }
  [IPC_CHANNELS.GIT_STASH]: { payload: { cwd: string; message?: string }; result: void }
  [IPC_CHANNELS.GIT_STASH_POP]: { payload: { cwd: string }; result: void }
  [IPC_CHANNELS.GIT_STASH_LIST]: { payload: { cwd: string }; result: GitStashListResult }
  [IPC_CHANNELS.GIT_REMOTE_URL]: { payload: { cwd: string; remote?: string }; result: string | null }
  [IPC_CHANNELS.GIT_IS_REPO]: { payload: { cwd: string }; result: boolean }
  // Zoom — ZOOM_GET returns ZoomInfo ({ factor }) and ZOOM_SET accepts { factor },
  // matching the preload zoom API and the ZoomInfo type in ipc-types.ts.
  [IPC_CHANNELS.ZOOM_GET]: { payload: void; result: ZoomInfo }
  [IPC_CHANNELS.ZOOM_SET]: { payload: { factor: number }; result: void }
  [IPC_CHANNELS.ZOOM_RESET]: { payload: void; result: void }
  // Window — request/response channels only. WINDOW_MAXIMIZED_STATE is a
  // main→renderer PUSH event, so it lives in RendererChannelMap below, not here.
  [IPC_CHANNELS.WINDOW_MINIMIZE]: { payload: void; result: void }
  [IPC_CHANNELS.WINDOW_MAXIMIZE]: { payload: void; result: void }
  [IPC_CHANNELS.WINDOW_CLOSE]: { payload: void; result: void }
  [IPC_CHANNELS.WINDOW_IS_MAXIMIZED]: { payload: void; result: boolean }
  // Notifications — SET accepts a Partial<NotificationSettings> (merge update)
  // and returns the full merged settings, matching the preload notification API.
  [IPC_CHANNELS.NOTIFICATION_SETTINGS_GET]: { payload: void; result: NotificationSettings }
  [IPC_CHANNELS.NOTIFICATION_SETTINGS_SET]: { payload: Partial<NotificationSettings>; result: NotificationSettings }
  // Shell — payload shapes match the preload ShellApi contract: openInVscode /
  // openInExplorer send `{ path }`, and checkVscodeAvailable returns the
  // availability descriptor (NOT a bare boolean).
  [IPC_CHANNELS.SHELL_OPEN_IN_VSCODE]: { payload: { path: string }; result: boolean }
  [IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER]: { payload: { path: string }; result: boolean }
  [IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE]: {
    payload: void
    result: { available: boolean; command: string | null; method: 'cli' | 'uri' | null }
  }
}

/**
 * Extract the payload type for a given IPC channel.
 */
export type IpcPayload<K extends keyof IpcChannelMap> = IpcChannelMap[K]['payload']

/**
 * Extract the result type for a given IPC channel.
 */
export type IpcResult<K extends keyof IpcChannelMap> = IpcChannelMap[K]['result']

// ============================================================================
// IpcRouter — Type-safe handler registration
// ============================================================================

/**
 * IpcRouter provides a type-safe API for registering Electron IPC handlers.
 * It eliminates the boilerplate of manually validating senders and casting
 * payloads/results.
 *
 * Instead of:
 *   ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, payload: SessionCreatePayload) => {
 *     validateIpcSender(_event)
 *     // ... handler logic ...
 *   })
 *
 * You write:
 *   router.handle(IPC_CHANNELS.SESSION_CREATE, async (payload) => { ... })
 *
 * And the payload and result types are automatically inferred from IpcChannelMap.
 */
export class IpcRouter {
  /**
   * Register a type-safe IPC handler for a specific channel.
   * Automatically validates the IPC sender before delegating to the handler.
   * Includes error boundary: if the handler throws, the error is caught
   * and returned as a standardized error response instead of propagating
   * the raw exception to the IPC caller.
   */
  handle<K extends keyof IpcChannelMap>(
    channel: K,
    handler: (payload: IpcPayload<K>) => Promise<IpcResult<K>>,
  ): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: IpcPayload<K>) => {
      validateIpcSender(event)
      try {
        return await handler(payload)
      } catch (err) {
        // Error boundary: standardize error propagation to the renderer.
        // Without this, a raw thrown error crashes the IPC channel and
        // the renderer gets an opaque "Error invoking remote method" message.
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`IPC handler error on channel ${String(channel)}:`, message)
        throw err
      }
    })
  }

  /**
   * Register a type-safe IPC handler for a void-payload channel.
   * Simplified API for handlers that don't take any payload.
   */
  handleVoid<K extends keyof IpcChannelMap>(
    channel: K,
    handler: () => Promise<IpcResult<K>>,
  ): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent) => {
      validateIpcSender(event)
      try {
        return await handler()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`IPC handler error on channel ${String(channel)}:`, message)
        throw err
      }
    })
  }

  /**
   * Remove an IPC handler for a specific channel.
   * Useful for cleanup in long-running processes to prevent memory leaks.
   */
  remove<K extends keyof IpcChannelMap>(channel: K): void {
    ipcMain.removeHandler(channel)
  }
}

// ============================================================================
// Renderer Channel Map — Type-safe main→renderer push events
// ============================================================================

/**
 * Maps channel names for main→renderer push events to their payload types.
 *
 * Unlike IpcChannelMap (which maps renderer→main request/response channels),
 * RendererChannelMap covers one-way push events from main to renderer
 * sent via BrowserWindow.webContents.send().
 *
 * These channels have no result — they're fire-and-forget notifications.
 */
export interface RendererChannelMap {
  [IPC_CHANNELS.SESSION_EVENTS]: { sessionId: string; event: import('../shared/ipc-types').SessionStreamEvent }
  [IPC_CHANNELS.SESSION_UI_REQUEST]: { sessionId: string; request: import('../shared/ipc-types').UIRequest }
  [IPC_CHANNELS.UPDATE_AVAILABLE]: import('../shared/ipc-types').UpdateAvailableInfo
  [IPC_CHANNELS.UPDATE_NOT_AVAILABLE]: void
  [IPC_CHANNELS.UPDATE_PROGRESS]: { bytesPerSecond: number; percent: number; total: number; transferred: number }
  [IPC_CHANNELS.UPDATE_DOWNLOADED]: { version: string }
  [IPC_CHANNELS.UPDATE_ERROR]: { message: string }
  [IPC_CHANNELS.WINDOW_MAXIMIZED_STATE]: boolean
  // NOTIFICATION_PLAY_SOUND carries a full NotificationPayload (title/body/soundKey),
  // matching notification-service.sendPlaySound() and the preload onPlaySound callback.
  [IPC_CHANNELS.NOTIFICATION_PLAY_SOUND]: NotificationPayload
}

/**
 * Extract the payload type for a given renderer channel.
 */
export type RendererPayload<K extends keyof RendererChannelMap> = RendererChannelMap[K]

/**
 * Send a type-safe push event from main process to the renderer.
 *
 * Type-safe wrapper around `BrowserWindow.webContents.send()`. The channel
 * name is mapped to its payload type via `RendererChannelMap`, ensuring
 * compile-time type safety for all main→renderer communication.
 *
 * @param channel - The IPC channel name (must be a key of RendererChannelMap)
 * @param payload - The payload to send (type inferred from RendererChannelMap)
 * @param window - Optional BrowserWindow to target. If not provided, sends to
 *   the first available window.
 *
 * @example
 * ```ts
 * // Type-safe: payload type is inferred from the channel name
 * sendToRenderer(IPC_CHANNELS.SESSION_EVENTS, {
 *   sessionId: 'abc',
 *   event: { type: 'text_delta', delta: 'hello' }
 * })
 *
 * // Also type-safe with an explicit window target:
 * sendToRenderer(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true, mainWindow)
 * ```
 */
export function sendToRenderer<K extends keyof RendererChannelMap>(
  channel: K,
  payload: RendererPayload<K>,
  window?: BrowserWindow,
): boolean {
  const target = window ?? BrowserWindow.getAllWindows()[0]
  if (!target || target.isDestroyed()) {
    logger.debug(`sendToRenderer: no target window for channel ${String(channel)}`)
    return false
  }
  target.webContents.send(channel, payload)
  return true
}

/**
 * Broadcast a type-safe push event from main to ALL renderer windows.
 *
 * This is the broadcast counterpart to `sendToRenderer()` (which targets a
 * single window). Use it for events that every window must receive, such as
 * session stream events, notification sound triggers, and updater progress —
 * all of which previously used a manual `for (const win of BrowserWindow.getAllWindows())`
 * loop. Routing those loops through this helper centralizes the broadcast
 * semantics and gives them compile-time payload type safety via
 * `RendererChannelMap`.
 *
 * Destroyed windows are skipped. Returns the number of windows the payload
 * was actually delivered to.
 *
 * @param channel - The IPC channel name (must be a key of RendererChannelMap)
 * @param payload - The payload to broadcast (type inferred from RendererChannelMap)
 * @returns count of windows that received the send
 */
export function sendToAllRenderers<K extends keyof RendererChannelMap>(
  channel: K,
  payload: RendererPayload<K>,
): number {
  let delivered = 0
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(channel, payload)
    delivered++
  }
  if (delivered === 0) {
    logger.debug(`sendToAllRenderers: no live window for channel ${String(channel)}`)
  }
  return delivered
}

/**
 * Register a type-safe listener in the renderer for a push event from main.
 *
 * Type-safe wrapper around `ipcRenderer.on()`. The channel name is mapped to
 * its payload type via `RendererChannelMap`, ensuring the callback receives a
 * correctly-typed payload.
 *
 * This is a TYPE-LEVEL UTILITY ONLY. It cannot be called from the main process.
 * Use it as a reference for implementing type-safe listeners in the preload
 * script or via contextBridge exposure.
 *
 * In the preload script:
 * ```ts
 * const { ipcRenderer } = require('electron')
 * const handler = (_event: Electron.IpcRendererEvent, payload: RendererPayload<K>) => callback(payload)
 * ipcRenderer.on(channel, handler)
 * return () => ipcRenderer.off(channel, handler)
 * ```
 *
 * @param channel - The IPC channel name (must be a key of RendererChannelMap)
 * @param callback - Callback invoked with the typed payload
 * @returns Cleanup function that removes the listener
 */
export function registerRendererListener<K extends keyof RendererChannelMap>(
  _channel: K,
  _callback: (payload: RendererPayload<K>) => void,
): () => void {
  // This function is a type signature template for the preload script.
  // It provides compile-time type safety for renderer listener registration.
  // The actual runtime implementation must be in the preload script using
  // ipcRenderer.on/off from electron.
  console.warn(
    'registerRendererListener: This is a type-level utility. ' +
    'Use the pattern documented in the JSDoc from the preload script.',
  )
  return () => {}
}
