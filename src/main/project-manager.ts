import { SessionManager } from '@mariozechner/pi-coding-agent'
import type { ProjectInfo, SessionInfoDisplay } from '../shared/ipc-types'

/** Internal representation of a tracked project */
interface Project {
  id: string
  path: string
  sessions: SessionInfoDisplay[]
}

/**
 * Manages projects in the sidebar.
 * Projects are keyed by lowercase-normalized path to handle case-insensitive filesystems.
 * Session discovery delegates to SessionManager.list() with graceful failure.
 */
export class ProjectManager {
  private projects = new Map<string, Project>()
  private nextId = 1

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
    return this.toProjectInfo(project)
  }

  /** Remove a project by ID. Returns true if found and removed. */
  removeProject(id: string): boolean {
    for (const [key, project] of this.projects) {
      if (project.id === id) {
        this.projects.delete(key)
        console.log(`[project] removed ${id}`)
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
