/**
 * Interfaces for session and project managers.
 * Both core managers and threaded wrappers implement these interfaces.
 */

import type {
  ChatMessageIPC,
  ModelInfo,
  ExtensionLoadError,
  ProjectInfo,
} from '../shared/ipc-types'

/**
 * Interface for session management operations.
 * Implemented by PiSessionManager and ThreadedSessionManager.
 */
export interface ISessionManager {
  // Session lifecycle
  create(cwd: string): Promise<string>
  reconnect(sessionId: string, cwd: string): Promise<ChatMessageIPC[]>
  prompt(sessionId: string, text: string): Promise<void>
  abort(sessionId: string): void
  dispose(sessionId: string): void
  disposeAll(): void
  deleteSession(sessionId: string, cwd: string): Promise<void>

  // Session info
  getHistory(sessionId: string): Promise<ChatMessageIPC[]>
  loadHistoryFromDisk(sessionId: string, cwd: string, limit?: number): Promise<ChatMessageIPC[]>
  getExtensionLoadErrors(sessionId: string): ExtensionLoadError[]
  getExtensionsDisabled(sessionId: string): boolean

  // Model operations
  getModel(sessionId: string): Promise<ModelInfo | null>
  listModels(): Promise<ModelInfo[]>
  setModel(sessionId: string, provider: string, modelId: string): Promise<ModelInfo>

  // Properties
  readonly sessionCount: number
}

/**
 * Interface for project management operations.
 * Implemented by ProjectManager and ThreadedProjectManager.
 */
export interface IProjectManager {
  // Workspace operations
  loadWorkspace(): Promise<void>

  // Project operations
  addProject(path: string): Promise<ProjectInfo>
  removeProject(id: string): Promise<boolean>
  listProjects(): ProjectInfo[]
  refreshSessions(projectId: string): Promise<ProjectInfo | null>

  // Active session
  setActiveSession(sessionId: string | null, projectPath: string | null): Promise<void>
  getActiveSession(): { sessionId: string | null; projectPath: string | null }
}
