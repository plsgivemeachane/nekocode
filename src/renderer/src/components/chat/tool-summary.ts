/**
 * DiffStats — line-level change statistics for file-modifying tool calls.
 * Extracted from the tool result (previousContent + newContent) for
 * write/edit tools, or from args analysis for other tools.
 */
export interface DiffStats {
  /** Number of lines added (shown in green) */
  added: number
  /** Number of lines removed (shown in red) */
  removed: number
  /** Whether these stats are estimated (no previousContent available) rather than from an actual diff */
  estimated?: boolean
}

/**
 * Extract diff stats from a tool call's args and result.
 *
 * For write/edit tools:
 *   - If result.previousContent exists (write tool that returned old content),
 *     we diff previousContent vs the new content from args.
 *   - Otherwise, we fall back to counting lines in args.content (write)
 *     or args.edits (edit) as additions.
 *
 * Returns null if the tool is not a file-modifying tool or if we cannot
 * determine the stats (e.g. no result yet, tool still running).
 */
export function extractDiffStats(toolName: string, args: unknown, result: unknown): DiffStats | null {
  const short = toolName.replace(/^toolcall_/, '')
  const argsObj = args as Record<string, unknown> | null | undefined
  const resultObj = result as Record<string, unknown> | null | undefined

  if (!argsObj) return null

  // Write tool — diff previousContent (from result) vs content (from args)
  if (short === 'write') {
    const newContent = typeof argsObj.content === 'string' ? argsObj.content : null
    if (!newContent) return null

    const previousContent = typeof resultObj?.previousContent === 'string'
      ? resultObj.previousContent
      : null

    if (previousContent !== null) {
      // We have both old and new — compute real diff stats
      return computeLineDiffStats(previousContent, newContent)
    }

    // No previous content — this is likely a new file creation or overwrite
    // without a baseline. Show all lines as additions, but mark as estimated
    // since we cannot know the actual diff without previousContent.
    const lineCount = newContent.split('\n').length
    return lineCount > 0 ? { added: lineCount, removed: 0, estimated: true } : null
  }

  // Edit tool — estimate from edits array
  if (short === 'edit') {
    const edits = Array.isArray(argsObj.edits) ? argsObj.edits : []
    if (edits.length === 0) return null

    // For edit tool, we can compute stats from oldText/newText in each edit
    let totalAdded = 0
    let totalRemoved = 0
    for (const edit of edits) {
      const e = edit as Record<string, unknown>
      const oldText = typeof e.oldText === 'string' ? e.oldText : ''
      const newText = typeof e.newText === 'string' ? e.newText : ''
      totalRemoved += oldText.split('\n').length
      totalAdded += newText.split('\n').length
    }
    return totalAdded > 0 || totalRemoved > 0 ? { added: totalAdded, removed: totalRemoved } : null
  }

  return null
}

/**
 * Compute line-level diff stats between two strings.
 * Uses a simple line-by-line comparison to count added/removed lines.
 */
function computeLineDiffStats(oldStr: string, newStr: string): DiffStats {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  // Use a simple LCS-based approach for accurate counts
  // For very large files, fall back to line-count difference
  if (oldLines.length > 5000 || newLines.length > 5000) {
    // Fallback: simple line count difference
    const diff = newLines.length - oldLines.length
    return {
      added: diff > 0 ? diff : 0,
      removed: diff < 0 ? Math.abs(diff) : 0,
    }
  }

  // Use set-based line counting for approximate but efficient diff stats.
  // This counts lines that appear in new but not in old (added) and vice versa.
  const oldSet = new Map<string, number>()
  for (const line of oldLines) {
    oldSet.set(line, (oldSet.get(line) ?? 0) + 1)
  }

  const newSet = new Map<string, number>()
  for (const line of newLines) {
    newSet.set(line, (newSet.get(line) ?? 0) + 1)
  }

  let added = 0
  let removed = 0

  // Count lines in new that are not in old (or more occurrences in new)
  for (const [line, count] of newSet) {
    const oldCount = oldSet.get(line) ?? 0
    if (count > oldCount) {
      added += count - oldCount
    }
  }

  // Count lines in old that are not in new (or more occurrences in old)
  for (const [line, count] of oldSet) {
    const newCount = newSet.get(line) ?? 0
    if (count > newCount) {
      removed += count - newCount
    }
  }

  return { added, removed }
}

export function extractToolSummary(toolName: string, args: unknown): string {
  const short = toolName.replace(/^toolcall_/, '')
  try {
    const a = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
    switch (short) {
      case 'read': {
        const pathVal = String(a.path ?? '')
        if (pathVal) {
          let s = pathVal
          if (a.offset) s += `:${a.offset}`
          if (a.limit) s += `-${Number(a.offset || 1) + Number(a.limit)}`
          return s
        }
        // No path but offset present — produce a meaningful fallback
        // instead of broken output like ':10'
        if (a.offset) {
          return `read (offset ${a.offset}${a.limit ? `, limit ${a.limit}` : ''})`
        }
        // No path and no offset — nothing meaningful to show
        return ''
      }
      case 'write':
        return String(a.path ?? '')
      case 'edit':
        return String(a.path ?? '')
      case 'bash':
        return String(a.command ?? '').split('\n')[0].slice(0, 80)
      case 'powershell':
        return String(a.command ?? '').split('\n')[0].slice(0, 80)
      case 'file_skeleton':
        return String(a.path ?? '')
      case 'repo_map':
        return String(a.keywords ?? '')
      case 'lsp':
        return `${a.action ?? ''} ${a.file ?? ''}`.trim()
      case 'tilldone':
        return String(a.text ?? a.action ?? '')
      case 'context_tag':
        return String(a.name ?? '')
      case 'context_log':
        return ''
      case 'context_checkout':
        return String(a.target ?? '')
      case 'ask_user':
        return String(a.question ?? '').slice(0, 60)
      case 'detect_package_manager':
        return ''
      case 'pi_version':
        return ''
      case 'pi_docs':
        return ''
      case 'pi_changelog':
        return String(a.version ?? 'latest')
      case 'pi_changelog_versions':
        return ''
      default: {
        const values = Object.values(a).filter((v): v is string => typeof v === 'string' && v.length > 0)
        return values[0]?.slice(0, 80) ?? ''
      }
    }
  } catch {
    return ''
  }
}
