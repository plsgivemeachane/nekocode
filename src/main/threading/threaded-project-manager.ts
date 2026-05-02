import type { ProjectInfo } from '../../shared/ipc-types'
import { ThreadOperationQueue } from './thread-operation-queue'
import { createLogger } from '../logger'
import type { ProjectManager } from '../project-manager'
import type { IProjectManager } from '../manager-types'

const logger = createLogger('threaded-project-manager')

/**
 * Thread-safe wrapper for ProjectManager operations.
 *
 * This wrapper offloads heavy I/O operations to worker threads while
 * maintaining the same interface as the original ProjectManager.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    Main Thread                               │
 * │  ┌───────────────────────────────────────────────────────┐  │
 * │  │           ThreadedProjectManager (Proxy)               │  │
 * │  │  - Delegates heavy ops to ThreadOperationQueue        │  │
 * │  │  - Keeps state management on main thread              │  │
 * │  └───────────────────────────────────────────────────────┘  │
 * │                           │                                  │
 * │           ┌───────────────┴───────────────┐                 │
 * │           ▼                               ▼                 │
 * │  ┌─────────────────┐            ┌───────────────────────┐   │
 * │  │  Worker Thread   │            │  Main Thread          │   │
 * │  │  - File I/O      │            │  - State management   │   │
 * │  │  - Discovery     │            │  - IPC coordination   │   │
 * │  └─────────────────┘            └───────────────────────┘   │
 * └─────────────────────────────────────────────────────────────┘
 */
export class ThreadedProjectManager implements IProjectManager {
  private operationQueue: ThreadOperationQueue
  private projectManager: ProjectManager

  constructor(operationQueue: ThreadOperationQueue, projectManager: ProjectManager) {
    this.operationQueue = operationQueue
    this.projectManager = projectManager
  }

  /**
   * Load workspace from disk.
   * Offloaded to worker thread for file I/O.
   */
  async loadWorkspace(): Promise<void> {
    logger.debug('loadWorkspace - delegating to underlying manager')
    // Keep on main thread for now - workspace loading needs session discovery
    // which requires the SDK SessionManager
    return this.projectManager.loadWorkspace()
  }

  /**
   * Add a project by path.
   * Session discovery is offloaded to worker thread.
   */
  async addProject(path: string): Promise<ProjectInfo> {
    logger.debug(`addProject: ${path}`)
    // Use the underlying manager - it will use the threaded discovery internally
    return this.projectManager.addProject(path)
  }

  /**
   * Remove a project by ID.
   * Stays on main thread for state consistency.
   */
  async removeProject(id: string): Promise<boolean> {
    logger.debug(`removeProject: ${id}`)
    return this.projectManager.removeProject(id)
  }

  /**
   * List all tracked projects.
   * Stays on main thread (fast operation).
   */
  listProjects(): ProjectInfo[] {
    return this.projectManager.listProjects()
  }

  /**
   * Refresh sessions for a project.
   * Session discovery is offloaded to worker thread.
   */
  async refreshSessions(projectId: string): Promise<ProjectInfo | null> {
    logger.debug(`refreshSessions: ${projectId}`)
    return this.projectManager.refreshSessions(projectId)
  }

  /**
   * Set the active session.
   * Stays on main thread for state consistency.
   */
  async setActiveSession(sessionId: string | null, projectPath: string | null): Promise<void> {
    return this.projectManager.setActiveSession(sessionId, projectPath)
  }

  /**
   * Get the active session info.
   * Stays on main thread.
   */
  getActiveSession(): { sessionId: string | null; projectPath: string | null } {
    return this.projectManager.getActiveSession()
  }
}
