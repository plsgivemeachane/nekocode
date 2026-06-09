/**
 * useSearchSessions.ts — Hook for searching sessions from the project store.
 *
 * Filters sessions by matching the query against session name / ID.
 * This is a pure client-side search — no IPC needed.
 */

import { useMemo } from 'react'
import { useProjectStore } from '../stores/project-store'

interface SessionSearchResult {
  /** Session ID */
  sessionId: string
  /** Display name (cwd basename or session ID prefix) */
  name: string
  /** The project path (cwd) */
  cwd: string
  /** Match relevance score (0–1) */
  score: number
}

/**
 * Simple substring matching with scoring.
 * Returns 0 if no match, higher scores for earlier/better matches.
 */
function matchScore(text: string, query: string): number {
  if (!query) return 0
  const lower = text.toLowerCase()
  const lowerQ = query.toLowerCase()

  const idx = lower.indexOf(lowerQ)
  if (idx === -1) return 0

  // Prefer matches at the start
  const positionBonus = idx === 0 ? 0.3 : 0
  // Prefer shorter texts (more specific)
  const lengthBonus = Math.max(0, 1 - text.length / 200) * 0.1

  return 0.5 + positionBonus + lengthBonus
}

/**
 * Search sessions across all projects in the project store.
 *
 * @param query - The search query string
 */
export function useSearchSessions(query: string): SessionSearchResult[] {
  const { state: projectState } = useProjectStore()

  return useMemo(() => {
    if (!query.trim()) return []

    const results: SessionSearchResult[] = []

    for (const project of projectState.projects) {
      // Match against project path (directory name)
      const projectScore = matchScore(project.path, query)

      for (const session of project.sessions) {
        // Use session firstMessage or id prefix as the display name
        const name = session.firstMessage
          ? session.firstMessage.slice(0, 40)
          : session.id.slice(0, 8)
        const idScore = matchScore(session.id, query)
        const nameScore = matchScore(name, query)

        const bestScore = Math.max(projectScore, idScore, nameScore)

        if (bestScore > 0) {
          results.push({
            sessionId: session.id,
            name,
            cwd: project.path,
            score: bestScore,
          })
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, 20)
  }, [query, projectState.projects])
}
