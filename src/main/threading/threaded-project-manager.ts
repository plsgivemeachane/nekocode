import type { ProjectInfo } from '../../shared/ipc-types'
import { ThreadOperationQueue } from './thread-operation-queue'
import type { ProjectLoadWorkspaceInput, ProjectLoadWorkspaceOutput, ProjectAddInput, ProjectAddOutput } from './types'
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
   * Offloads file I/O to worker thread, then applies results to main-thread ProjectManager.
   */
  async loadWorkspace(): Promise<void> {
    logger.debug('loadWorkspace - offloading to operation queue')
    const result = await this.operationQueue.execute<ProjectLoadWorkspaceInput, ProjectLoadWorkspaceOutput>(
      'project:load-workspace',
      { workspacePath: this.projectManager.getWorkspacePath() }
    )
    // Apply the workspace data to the main-thread ProjectManager
    // Session discovery happens on main thread since it uses SessionManager
    // which may need access to Electron APIs
    await this.projectManager.restoreWorkspace(result)
  }

  /**
   * Add a project by path.
   * Session discovery is offloaded to worker thread.
   */
  async addProject(path: string): Promise<ProjectInfo> {
    logger.debug(`addProject: ${path} - offloading to operation queue`)
    return this.operationQueue.execute<ProjectAddInput, ProjectAddOutput>(
      'project:add',
      { path }
    )
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
