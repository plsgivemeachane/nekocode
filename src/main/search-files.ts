/**
 * search-files.ts — File search engine for the main process.
 *
 * Walks the project directory tree and fuzzy-matches the query against file paths.
 * Results are scored using a simple substring/character-sequence matching algorithm
 * inspired by VS Code's file search. No external dependencies (Fuse.js) are needed
 * for the MVP — the built-in scoring is sufficient for most projects.
 */

import { readdir } from 'fs/promises'
import { join, relative, basename } from 'path'
import type { SearchFilesRequest, SearchResultEntry } from '../shared/ipc-types'

// ━━ Default configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Directories always excluded from search */
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.cache',
  '.turbo',
  'coverage',
  '.nuxt',
  '.output',
])

/** Maximum number of results returned by default */
const DEFAULT_LIMIT = 50

/** Maximum directory depth to walk */
const MAX_DEPTH = 20

// ━━ Fuzzy matching ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Score a candidate string against a query.
 * Returns a number between 0 and 1 (higher = better match).
 *
 * Scoring strategy:
 * - Exact substring match gets the highest score
 * - Character-by-character sequential match gets a medium score
 * - Bonus for matches at word boundaries (camelCase, snake_case, path separators)
 * - Penalty for gaps between matched characters
 */
function fuzzyScore(candidate: string, query: string): number {
  if (!query) return 0

  const lowerCandidate = candidate.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // Exact substring match — highest score
  const substringIdx = lowerCandidate.indexOf(lowerQuery)
  if (substringIdx !== -1) {
    // Prefer matches at the start or after a separator
    const boundaryBonus =
      substringIdx === 0 || '/\\_'.includes(candidate[substringIdx - 1]) ? 0.1 : 0
    // Prefer shorter candidates (more specific match)
    const lengthBonus = Math.max(0, 1 - candidate.length / 200) * 0.1
    return 0.8 + boundaryBonus + lengthBonus
  }

  // Character-by-character sequential match
  let qi = 0
  let score = 0
  let lastMatchIdx = -2

  for (let ci = 0; ci < candidate.length && qi < query.length; ci++) {
    if (lowerCandidate[ci] === lowerQuery[qi]) {
      // Boundary bonus: match at start, after path separator, underscore, or camelCase transition
      const isBoundary =
        ci === 0 ||
        '/\\_'.includes(candidate[ci - 1]) ||
        (candidate[ci]!.toUpperCase() === candidate[ci] && candidate[ci - 1]!.toLowerCase() === candidate[ci - 1])

      if (isBoundary) score += 2
      else score += 1

      // Consecutive match bonus
      if (ci === lastMatchIdx + 1) score += 1

      lastMatchIdx = ci
      qi++
    }
  }

  // If we didn't match all query characters, it's not a match
  if (qi < query.length) return 0

  // Normalize score to 0–1 range
  const maxPossibleScore = query.length * 4 // boundary + consecutive for every char
  return Math.min(0.7, score / maxPossibleScore)
}

// ━━ Directory walking ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Recursively walk a directory and collect file paths.
 * Respects exclude directories and extension filters.
 */
async function walkDir(
  dir: string,
  rootPath: string,
  excludeDirs: Set<string>,
  extensions: Set<string> | null,
  depth: number,
  results: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) return

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // Permission denied or other FS error — skip silently
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip excluded directories and hidden directories (starting with .)
      if (excludeDirs.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.')) {
        continue
      }
      await walkDir(fullPath, rootPath, excludeDirs, extensions, depth + 1, results)
    } else if (entry.isFile()) {
      // Extension filter
      if (extensions) {
        const ext = getExtension(entry.name)
        if (!extensions.has(ext)) continue
      }
      results.push(fullPath)
    }
  }
}

/** Extract file extension including the dot (e.g., '.ts') */
function getExtension(fileName: string): string {
  const dotIdx = fileName.lastIndexOf('.')
  return dotIdx !== -1 ? fileName.substring(dotIdx) : ''
}

// ━━ Public API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Search for files in a project directory matching a query string.
 *
 * @param request - Search request with projectPath, query, and optional filters
 * @returns Array of search results sorted by score (descending)
 */
export async function searchFiles(request: SearchFilesRequest): Promise<SearchResultEntry[]> {
  const { projectPath, query, limit = DEFAULT_LIMIT, extensions, excludeDirs } = request

  // Merge exclude directories with defaults
  const mergedExcludes = new Set([...DEFAULT_EXCLUDE_DIRS, ...(excludeDirs ?? [])])

  // Build extension filter set
  const extSet = extensions && extensions.length > 0 ? new Set(extensions) : null

  // Walk the directory tree and collect all candidate file paths
  const allFiles: string[] = []
  await walkDir(projectPath, projectPath, mergedExcludes, extSet, 0, allFiles)

  // If no query, return files sorted by name (limited)
  if (!query.trim()) {
    return allFiles
      .sort((a, b) => basename(a).localeCompare(basename(b)))
      .slice(0, limit)
      .map((absolutePath) => {
        const relativePath = relative(projectPath, absolutePath)
        return {
          relativePath,
          absolutePath,
          fileName: basename(absolutePath),
          score: 0,
        }
      })
  }

  // Score each file against the query and keep the best matches
  const scored: SearchResultEntry[] = []
  for (const absolutePath of allFiles) {
    const relativePath = relative(projectPath, absolutePath)
    const fileName = basename(absolutePath)

    // Score against both the full relative path and just the file name
    // File name match is weighted more heavily
    const pathScore = fuzzyScore(relativePath, query)
    const nameScore = fuzzyScore(fileName, query)
    const score = Math.max(nameScore * 1.2, pathScore)

    if (score > 0) {
      scored.push({ relativePath, absolutePath, fileName, score: Math.min(1, score) })
    }
  }

  // Sort by score descending, then alphabetically for ties
  scored.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))

  return scored.slice(0, limit)
}
