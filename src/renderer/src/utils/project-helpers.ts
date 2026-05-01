import type { ProjectInfo, SessionInfoDisplay } from '../../../shared/ipc-types'

/**
 * Check if a session ID is a pending placeholder.
 * Pending sessions are optimistic UI placeholders created before
 * the real session is initialized in the backend.
 *
 * @param id - The session ID to check
 * @returns true if the session ID is a pending placeholder, false otherwise
 */
export function isPendingSession(id: string | null | undefined): id is `pending-${string}` {
  return id?.startsWith('pending-') ?? false
}

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
