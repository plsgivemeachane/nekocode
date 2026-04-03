import { app } from 'electron'
import { SessionManager } from '@mariozechner/pi-coding-agent'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import type { ProjectInfo, SessionInfoDisplay } from '../shared/ipc-types'

/** Internal representation of a tracked project */
interface Project {
  id: string
  path: string
  sessions: SessionInfoDisplay[]
}

/** Persisted workspace state */
interface WorkspaceState {
  projectPaths: string[]
  activeSessionId: string | null
  activeProjectPath: string | null
}

/**
 * Manages projects in the sidebar with disk persistence.
 * Projects are keyed by lowercase-normalized path to handle case-insensitive filesystems.
 * Session discovery delegates to SessionManager.list() with graceful failure.
 */
export class ProjectManager {
  private projects = new Map<string, Project>()
  private nextId = 1
  private workspacePath: string
  private activeSessionId: string | null = null
  private activeProjectPath: string | null = null

  constructor() {
    this.workspacePath = join(app.getPath('userData'), 'workspace.json')
  }

  /**
   * Load persisted workspace from disk and restore projects.
   * Call once on app startup before registering IPC handlers.
   */
  async loadWorkspace(): Promise<void> {
    try {
      const data = await readFile(this.workspacePath, 'utf-8')
      const state: WorkspaceState = JSON.parse(data)

      this.activeSessionId = state.activeSessionId ?? null
      this.activeProjectPath = state.activeProjectPath ?? null

      // Restore each project path — discover sessions for each
      for (const path of state.projectPaths) {
        const id = `project-${this.nextId++}`
        const sessions = await this.discoverSessions(path)
        const key = path.toLowerCase()
        const project: Project = { id, path, sessions }
        this.projects.set(key, project)
        console.log(`[project] restored ${id} path=${path} sessions=${sessions.length}`)
      }

      console.log(`[project] workspace loaded: ${this.projects.size} project(s)`)
    } catch (err) {
      // File doesn't exist yet or is corrupt — start fresh
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[project] failed to load workspace:', err)
      }
    }
  }

  /** Persist the active session selection to the workspace file. */
  async setActiveSession(sessionId: string | null, projectPath: string | null): Promise<void> {
    this.activeSessionId = sessionId
    this.activeProjectPath = projectPath
    await this.saveWorkspace()
  }

  /** Get the last active session info for auto-restoration by the renderer. */
  getActiveSession(): { sessionId: string | null; projectPath: string | null } {
    return {
      sessionId: this.activeSessionId,
      projectPath: this.activeProjectPath,
    }
  }

  /**
   * Add a project by its filesystem path.
   * Discovers existing pi sessions via SessionManager.list().
   * If the same path (case-insensitive) is already tracked, returns the existing project.
   */
  async addProject(path: string): Promise<ProjectInfo> {
    const key = path.toLowerCase()
    const existing = this.projects.get(key)
    if (existing) {
      console.log(`[project] already tracked: ${existing.id} path=${path}`)
      return this.toProjectInfo(existing)
    }

    const id = `project-${this.nextId++}`
    const sessions = await this.discoverSessions(path)

    const project: Project = { id, path, sessions }
    this.projects.set(key, project)
    console.log(`[project] added ${id} path=${path} sessions=${sessions.length}`)

    await this.saveWorkspace()
    return this.toProjectInfo(project)
  }

  /** Remove a project by ID. Returns true if found and removed. */
  async removeProject(id: string): Promise<boolean> {
    for (const [key, project] of this.projects) {
      if (project.id === id) {
        this.projects.delete(key)
        console.log(`[project] removed ${id}`)

        // Clear active session if it belonged to this project
        if (this.activeProjectPath === project.path) {
          this.activeSessionId = null
          this.activeProjectPath = null
        }

        await this.saveWorkspace()
        return true
      }
    }
    console.log(`[project] remove failed: ${id} not found`)
    return false
  }

  /** List all tracked projects. */
  listProjects(): ProjectInfo[] {
    return Array.from(this.projects.values()).map((p) => this.toProjectInfo(p))
  }

  /** Re-discover sessions for a project and update the stored list. */
  async refreshSessions(projectId: string): Promise<ProjectInfo | null> {
    const project = this.findProject(projectId)
    if (!project) return null

    project.sessions = await this.discoverSessions(project.path)
    console.log(`[project] refreshed ${projectId} sessions=${project.sessions.length}`)
    return this.toProjectInfo(project)
  }

  /**
   * Discover sessions for a path using SessionManager.list().
   * Returns empty array on failure (logged) instead of throwing.
   */
  private async discoverSessions(path: string): Promise<SessionInfoDisplay[]> {
    try {
      const sessions = await SessionManager.list(path)
      return sessions.map((s) => ({
        id: s.id,
        firstMessage: s.firstMessage,
        created: s.created.toISOString(),
        messageCount: s.messageCount,
      }))
    } catch (err) {
      console.error(`[project] session discovery failed for ${path}:`, err)
      return []
    }
  }

  /** Persist current workspace state to disk. */
  private async saveWorkspace(): Promise<void> {
    try {
      const state: WorkspaceState = {
        projectPaths: Array.from(this.projects.values()).map((p) => p.path),
        activeSessionId: this.activeSessionId,
        activeProjectPath: this.activeProjectPath,
      }
      await mkdir(join(app.getPath('userData')), { recursive: true })
      await writeFile(this.workspacePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch (err) {
      console.error('[project] failed to save workspace:', err)
    }
  }

  private findProject(id: string): Project | undefined {
    for (const project of this.projects.values()) {
      if (project.id === id) return project
    }
    return undefined
  }

  private toProjectInfo(project: Project): ProjectInfo {
    return {
      id: project.id,
      path: project.path,
      sessions: project.sessions,
    }
  }
}
