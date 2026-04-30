import type { ProjectInfo, SessionInfoDisplay } from '../../../shared/ipc-types'

/**
 * Update a single session inside a project list (immutable).
 * Returns a new projects array with the matching session replaced.
 * If no session matches, returns the original array unchanged.
 */
export function updateSessionInProject(
  projects: ProjectInfo[],
  sessionId: string,
  updater: (session: SessionInfoDisplay) => SessionInfoDisplay,
): ProjectInfo[] {
  return projects.map(p => ({
    ...p,
    sessions: p.sessions.map(s =>
      s.id === sessionId ? updater(s) : s,
    ),
  }))
}
