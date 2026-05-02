/**
 * Core types for the threading infrastructure.
 * These types define the communication protocol between main thread and worker threads.
 */

import type { ProjectInfo, SessionInfoDisplay, ChatMessageIPC, ModelInfo, ExtensionLoadError, SessionStreamEvent } from '../../shared/ipc-types'

// ============================================================================
// Thread Pool Configuration
// ============================================================================

/**
 * Configuration for the thread pool
 */
export interface ThreadPoolConfig {
  /** Minimum number of worker threads (default: 2) */
  minThreads: number
  /** Maximum number of worker threads (default: 4) */
  maxThreads: number
  /** ms before idle thread terminates (default: 30000) */
  idleTimeout: number
  /** ms before task is considered stalled (default: 60000) */
  taskTimeout: number
}

/**
 * Default thread pool configuration
 */
export const DEFAULT_POOL_CONFIG: ThreadPoolConfig = {
  minThreads: 2,
  maxThreads: 4,
  idleTimeout: 30000,
  taskTimeout: 60000,
}

/**
 * Statistics about the thread pool
 */
export interface ThreadPoolStats {
  activeThreads: number
  idleThreads: number
  pendingOperations: number
  completedOperations: number
  failedOperations: number
}

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Priority levels for operations
 */
export type OperationPriority = 'high' | 'normal' | 'low'

/**
 * Base interface for all thread operations
 */
export interface ThreadOperation<TInput = unknown> {
  id: string
  type: OperationType
  input: TInput
  priority: OperationPriority
  timestamp: number
}

/**
 * All operation types supported by the thread pool
 */
export type OperationType =
  // Project operations
  | 'project:load-workspace'
  | 'project:add'
  | 'project:remove'
  | 'project:refresh-sessions'
  | 'project:discover-sessions'
  | 'project:save-workspace'
  | 'project:set-active-session'
  | 'project:get-active-session'
  | 'project:list'
  // Session operations
  | 'session:create'
  | 'session:reconnect'
  | 'session:prompt'
  | 'session:abort'
  | 'session:dispose'
  | 'session:dispose-all'
  | 'session:delete'
  | 'session:load-history'
  | 'session:load-history-disk'
  | 'session:list-models'
  | 'session:set-model'
  | 'session:get-model'
  | 'session:get-extension-errors'
  | 'session:get-extensions-disabled'

// ============================================================================
// Input/Output Types for Operations
// ============================================================================

// --- Project Operations ---

export interface ProjectLoadWorkspaceInput {
  workspacePath: string
}

export interface ProjectLoadWorkspaceOutput {
  projectPaths: string[]
  activeSessionId: string | null
  activeProjectPath: string | null
}

export interface ProjectAddInput {
  path: string
}

export type ProjectAddOutput = ProjectInfo

export interface ProjectRemoveInput {
  id: string
}

export interface ProjectRemoveOutput {
  success: boolean
}

export interface ProjectRefreshSessionsInput {
  projectId: string
}

export type ProjectRefreshSessionsOutput = ProjectInfo

export interface ProjectDiscoverSessionsInput {
  path: string
}

export interface ProjectDiscoverSessionsOutput {
  sessions: SessionInfoDisplay[]
}

export interface ProjectSaveWorkspaceInput {
  projectPaths: string[]
  activeSessionId: string | null
  activeProjectPath: string | null
  workspacePath: string
}

export interface ProjectSaveWorkspaceOutput {
  success: boolean
}

export interface ProjectSetActiveSessionInput {
  sessionId: string | null
  projectPath: string | null
}

export interface ProjectSetActiveSessionOutput {
  success: boolean
}

export interface ProjectGetActiveSessionOutput {
  sessionId: string | null
  projectPath: string | null
}

export interface ProjectListOutput {
  projects: ProjectInfo[]
}

// --- Session Operations ---

export interface SessionCreateInput {
  cwd: string
}

export interface SessionCreateOutput {
  sessionId: string
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
}

export interface SessionReconnectInput {
  sessionId: string
  cwd: string
}

export interface SessionReconnectOutput {
  sessionId: string
  history: ChatMessageIPC[]
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
}

export interface SessionPromptInput {
  sessionId: string
  text: string
}

export interface SessionPromptOutput {
  success: boolean
}

export interface SessionAbortInput {
  sessionId: string
}

export interface SessionAbortOutput {
  success: boolean
}

export interface SessionDisposeInput {
  sessionId: string
}

export interface SessionDisposeOutput {
  success: boolean
}

export interface SessionDeleteInput {
  sessionId: string
  cwd: string
}

export interface SessionDeleteOutput {
  success: boolean
}

export interface SessionLoadHistoryInput {
  sessionId: string
}

export interface SessionLoadHistoryOutput {
  messages: ChatMessageIPC[]
}

export interface SessionLoadHistoryDiskInput {
  sessionId: string
  cwd: string
  limit: number
}

export interface SessionLoadHistoryDiskOutput {
  messages: ChatMessageIPC[]
}

export type SessionListModelsInput = Record<string, never>

export interface SessionListModelsOutput {
  models: ModelInfo[]
}

export interface SessionSetModelInput {
  sessionId: string
  provider: string
  modelId: string
}

export type SessionSetModelOutput = ModelInfo

export interface SessionGetModelInput {
  sessionId: string
}

export type SessionGetModelOutput = ModelInfo

export interface SessionGetExtensionErrorsInput {
  sessionId: string
}

export interface SessionGetExtensionErrorsOutput {
  errors: ExtensionLoadError[]
}

export interface SessionGetExtensionsDisabledInput {
  sessionId: string
}

export interface SessionGetExtensionsDisabledOutput {
  disabled: boolean
}

// ============================================================================
// Worker Communication Types
// ============================================================================

/**
 * Message sent from main thread to worker
 */
export interface WorkerMessage<TInput = unknown> {
  id: string
  type: OperationType
  input: TInput
}

/**
 * Response sent from worker to main thread
 */
export interface WorkerResponse<TOutput = unknown> {
  id: string
  success: boolean
  result?: TOutput
  error?: string
}

/**
 * Event sent from worker to main thread (for streaming events)
 * This is used for real-time event forwarding during session operations
 */
export interface WorkerEventMessage {
  type: 'session_event'
  sessionId: string
  event: SessionStreamEvent
}

/**
 * Event sent from worker to main thread (for streaming events)
 */
export interface WorkerEvent {
  sessionId: string
  event: SessionStreamEvent
}

// ============================================================================
// Operation Handler Types
// ============================================================================

/**
 * Generic operation handler function type
 */
export type OperationHandler<TInput, TOutput> = (input: TInput) => Promise<TOutput>

/**
 * Map of operation types to their handlers
 */
export type OperationHandlerMap = Map<OperationType, OperationHandler<unknown, unknown>>
