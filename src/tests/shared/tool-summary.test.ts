/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { extractToolSummary, extractDiffStats } from '@/renderer/src/components/chat/tool-summary'

// ═══════════════════════════════════════════════════════════════════════
// CRITICAL TESTING: extractDiffStats
//
// CONTRACT: "Extract diff stats from a tool call's args and result"
// AUDIT: The name says "diff stats" but for write without previousContent,
//   it does NOT diff — it counts lines. The name is dishonest.
//   For edit, it counts lines in oldText/newText, not actual diffs.
// ═══════════════════════════════════════════════════════════════════════

describe('extractDiffStats — Contract Violations', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Name vs Reality
  // "extractDiffStats" implies diffing, but write without previousContent
  // just counts lines. This is a guess, not a diff.
  // ═══════════════════════════════════════════════════════════════════════

  describe('Name vs Reality: write without previousContent is NOT a diff', () => {
    it('write without previousContent should indicate estimated stats, not definitive diff — the function cannot know', () => {
      // If I "write" to an existing file, all lines are replacements, not additions.
      // But extractDiffStats with no previousContent says { added: 5, removed: 0 }.
      // This is the function LYING about what it knows.
      // CORRECT behavior: when there is no previousContent, the function should
      // return stats with an `estimated: true` flag to distinguish guesses from
      // actual diffs. Now fixed — DiffStats.estimated is set when no previousContent.
      const result = extractDiffStats('write', { path: '/existing-file.ts', content: 'a\nb\nc\nd\ne' }, null)
      expect(result).toEqual({ added: 5, removed: 0, estimated: true })
      // CONTRACT VIOLATION: The name says "diff stats" but there is no diff here.
      // This is a line count masquerading as a diff statistic.
      // When fixed, the function should include `estimated: true` to be honest.
    })

    it('empty string content is tracked as a valid write operation', () => {
      // Writing empty string "" to a file means "make it empty" or "create empty file".
      // This IS a valid operation — the file is being changed to have no content.
      // Previously BUG: `if (!newContent) return null` treated "" as falsy and dropped it.
      // FIX: Now checks `newContent === null` explicitly so empty string is tracked.
      const result = extractDiffStats('write', { path: '/f', content: '' }, null)
      expect(result).not.toBeNull()
      // Empty string splits to [''] which has length 1
      expect(result).toEqual({ added: 1, removed: 0, estimated: true })
    })

    it('single newline content counts as 2 lines — debatable semantics', () => {
      // "\n".split('\n') gives ["", ""] — length 2.
      // So writing a single newline reports { added: 2, removed: 0, estimated: true }.
      const result = extractDiffStats('write', { path: '/f', content: '\n' }, null)
      expect(result).toEqual({ added: 2, removed: 0, estimated: true })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Argument Boundary — what the signature allows vs what it should
  // ═══════════════════════════════════════════════════════════════════════

  describe('Argument Boundary: args is "unknown" but treated as Record<string, unknown>', () => {
    it('passes a string as args — survives the null check but is an object', () => {
      // The function checks !argsObj which is false for non-null/undefined.
      // But argsObj.content on a string gives undefined.
      // So it falls through to return null for write. But it doesn't crash.
      const result = extractDiffStats('write', 'just-a-string', null)
      expect(result).toBeNull()
    })

    it('passes a number as args — same issue, no crash but meaningless', () => {
      const result = extractDiffStats('write', 42, null)
      expect(result).toBeNull()
    })

    it('passes a boolean as args — true is an object in JS', () => {
      // typeof true === 'boolean', but the code does `args as Record<string, unknown>`
      // Boolean(true) has no .content property
      const result = extractDiffStats('write', true, null)
      expect(result).toBeNull()
    })

    it('passes an array as args — arrays are objects, could have unexpected behavior', () => {
      // [] is an object. argsObj.content is undefined. No crash.
      const result = extractDiffStats('write', [{ content: 'hello' }], null)
      expect(result).toBeNull()
    })

    it('passes args with content as a number — typeof check catches it', () => {
      const result = extractDiffStats('write', { path: '/f', content: 123 }, null)
      expect(result).toBeNull()
    })

    it('passes args with content as an object — typeof check catches it', () => {
      const result = extractDiffStats('write', { path: '/f', content: { text: 'hello' } }, null)
      expect(result).toBeNull()
    })

    it('passes args with content as boolean true — typeof check catches it', () => {
      const result = extractDiffStats('write', { path: '/f', content: true }, null)
      expect(result).toBeNull()
    })
  })

  describe('Argument Boundary: result is "unknown" — hostile result objects', () => {
    it('result.previousContent as a number — not a string, so ignored', () => {
      // typeof result.previousContent !== 'string', so falls through to line counting
      const result = extractDiffStats('write', { path: '/f', content: 'hello' }, { previousContent: 42 })
      expect(result).toEqual({ added: 1, removed: 0, estimated: true })
      // previousContent is not a string, so it's ignored — treated as no baseline.
      // The estimated flag indicates these stats are not from a real diff.
    })

    it('result.previousContent as an object — not a string, so ignored', () => {
      const result = extractDiffStats('write', { path: '/f', content: 'hello' }, { previousContent: { text: 'old' } })
      expect(result).toEqual({ added: 1, removed: 0, estimated: true })
    })

    it('result as a string — result.previousContent on a string is undefined', () => {
      const result = extractDiffStats('write', { path: '/f', content: 'hello' }, 'result-string')
      expect(result).toEqual({ added: 1, removed: 0, estimated: true })
    })

    it('result as null — should not crash', () => {
      const result = extractDiffStats('write', { path: '/f', content: 'hello' }, null)
      expect(result).toEqual({ added: 1, removed: 0, estimated: true })
    })

    it('result as undefined — should not crash', () => {
      const result = extractDiffStats('write', { path: '/f', content: 'hello' }, undefined)
      expect(result).toEqual({ added: 1, removed: 0, estimated: true })
    })
  })

  describe('Argument Boundary: edit tool with hostile edits arrays', () => {
    it('edit with edits containing null items — CRASHES on property access (BUG)', () => {
      // edits: [null] — each edit is cast to Record<string, unknown>
      // But null cannot have properties accessed on it.
      // The code does `edit as Record<string, unknown>` then `e.oldText`
      // which throws TypeError: Cannot read properties of null
      // BUG: extractDiffStats crashes when edits array contains null/undefined items.
      // The contract says args is `unknown` — there is no validation of edits contents.
      expect(() => extractDiffStats('edit', { path: '/f', edits: [null as any] }, null)).toThrow()
      // This is a REAL BUG: the function crashes instead of gracefully handling invalid edits.
    })

    it('edit with edits containing undefined oldText/newText — counts as +1 -1', () => {
      // edit without oldText or newText: both default to ''
      // ''.split('\n').length === 1
      // So we get { added: 1, removed: 1 } for an edit that does NOTHING
      const result = extractDiffStats('edit', { path: '/f', edits: [{ path: '/f' }] }, null)
      // The edit has no oldText or newText — it's meaningless.
      // But the function counts it as +1 -1.
      expect(result).not.toBeNull()
      if (result) {
        // This reveals the function treats empty strings as 1-line edits
        expect(result.added).toBe(1)
        expect(result.removed).toBe(1)
      }
    })

    it('edit with edits where oldText is multiline but newText is empty string', () => {
      // Replacing 5 lines with nothing — is it removing 5 lines or replacing 5 lines with 1 empty line?
      const result = extractDiffStats('edit', {
        path: '/f',
        edits: [{ oldText: 'a\nb\nc\nd\ne', newText: '' }],
      }, null)
      // newText ''.split('\n').length === 1 (the empty string line)
      // oldText 'a\nb\nc\nd\ne'.split('\n').length === 5
      expect(result).toEqual({ added: 1, removed: 5 })
      // Is adding an empty string really "1 addition"? Debatable.
    })

    it('edit with edits array containing a mix of valid and empty edits', () => {
      const result = extractDiffStats('edit', {
        path: '/f',
        edits: [
          { oldText: 'real old', newText: 'real new' },
          { oldText: '', newText: '' }, // Does nothing but counts +1 -1
        ],
      }, null)
      // First edit: 1 removed, 1 added
      // Second edit: '' split = [''] → 1 removed, 1 added
      // Total: 2 added, 2 removed
      // But the second edit is semantically a no-op!
      expect(result).toEqual({ added: 2, removed: 2 })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Abstraction Ambiguity — computeLineDiffStats
  // The set-based frequency approach is NOT a real diff.
  // ═══════════════════════════════════════════════════════════════════════

  describe('Abstraction Ambiguity: set-based diff is NOT a real diff', () => {
    it('reordering identical lines shows correct changes — LCS respects line order', () => {
      // If I swap two lines, a real diff shows -2 +2.
      // Previously: set-based approach saw same lines, same frequencies → 0 changes (BUG).
      // FIX: LCS-based approach correctly detects reordering as added+removed.
      const result = extractDiffStats(
        'write',
        { path: '/f', content: 'b\na' },
        { previousContent: 'a\nb' }
      )
      expect(result).toEqual({ added: 1, removed: 1 })
      // Lines were reordered: LCS finds 1 common line ('a' or 'b'), so 1 added + 1 removed.
      // This correctly detects that a change happened, unlike the old set-based approach
      // which reported { added: 0, removed: 0 } for reordering.
    })

    it('duplicate lines added/removed are tracked by frequency — correct', () => {
      // "a\na\na" → "a": LCS sees 'a' as common subsequence of length 1 → removed: 2
      const result = extractDiffStats(
        'write',
        { path: '/f', content: 'a' },
        { previousContent: 'a\na\na' }
      )
      expect(result).toEqual({ added: 0, removed: 2 })
    })

    it('replacing all unique lines shows correct counts', () => {
      const result = extractDiffStats(
        'write',
        { path: '/f', content: 'x\ny\nz' },
        { previousContent: 'a\nb\nc' }
      )
      expect(result).toEqual({ added: 3, removed: 3 })
      // This is correct because all lines are unique.
    })

    it('large file with same line count but all different content shows correct changes', () => {
      // Previously: fallback for files > 5000 lines used simple line count difference,
      // reporting { added: 0, removed: 0 } when line counts matched — COMPLETELY WRONG.
      // FIX: Now uses set-based diff for large files (>20000 combined lines),
      // which correctly identifies all unique lines as changed.
      const oldLines = Array.from({ length: 5001 }, (_, i) => `old-line-${i}`)
      const newLines = Array.from({ length: 5001 }, (_, i) => `new-line-${i}`)
      const result = extractDiffStats(
        'write',
        { path: '/f', content: newLines.join('\n') },
        { previousContent: oldLines.join('\n') }
      )
      // All lines are unique and different → all old lines removed, all new lines added
      expect(result).not.toBeNull()
      expect(result!.added).toBe(5001)
      expect(result!.removed).toBe(5001)
    })

    it('large file fallback: adding 1 line to 5001-line file shows +1 correctly', () => {
      const oldLines = Array.from({ length: 5001 }, (_, i) => `line-${i}`)
      const newLines = [...oldLines, 'extra-line']
      const result = extractDiffStats(
        'write',
        { path: '/f', content: newLines.join('\n') },
        { previousContent: oldLines.join('\n') }
      )
      expect(result).toEqual({ added: 1, removed: 0 })
      // The fallback happens to work for pure additions/removals.
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: Idempotency & Edge Cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('Idempotency & Edge Cases', () => {
    it('toolcall_ prefix stripping is consistent across write and edit', () => {
      const writeResult = extractDiffStats('toolcall_write', { path: '/f', content: 'hello' }, null)
      const editResult = extractDiffStats('toolcall_edit', { path: '/f', edits: [{ oldText: 'a', newText: 'b' }] }, null)
      expect(writeResult).not.toBeNull()
      expect(editResult).not.toBeNull()
    })

    it('unknown tool returns null — no false positives', () => {
      expect(extractDiffStats('unknown', { content: 'hello' }, null)).toBeNull()
      expect(extractDiffStats('bash', { command: 'ls' }, null)).toBeNull()
      expect(extractDiffStats('read', { path: '/f' }, null)).toBeNull()
    })

    it('write with content that is exactly the same as previousContent shows zero changes', () => {
      const content = 'same\ncontent\nhere'
      const result = extractDiffStats('write', { path: '/f', content }, { previousContent: content })
      expect(result).toEqual({ added: 0, removed: 0 })
    })

    it('write where previousContent is empty string and content is empty string — returns zero changes', () => {
      // Empty string content is now properly tracked: `if (newContent === null) return null`
      // So writing empty to empty shows { added: 0, removed: 0 } — no changes.
      // Previously BUG: `if (!newContent) return null` treated "" as falsy and returned null.
      const result = extractDiffStats('write', { path: '/f', content: '' }, { previousContent: '' })
      expect(result).not.toBeNull()
      expect(result).toEqual({ added: 0, removed: 0 })
    })

    it('write where only CRLF vs LF differs — set-based diff may or may not catch it', () => {
      // '\r\n' split by '\n' gives ['\r'] vs '' split by '\n' gives ['']
      // '\r' !== '' so it would show as a change
      const result = extractDiffStats(
        'write',
        { path: '/f', content: 'line1\nline2' },
        { previousContent: 'line1\r\nline2' }
      )
      // 'line1' matches, but 'line2' vs 'line2' — wait, let's think:
      // old: 'line1\r\nline2'.split('\n') = ['line1\r', 'line2']
      // new: 'line1\nline2'.split('\n') = ['line1', 'line2']
      // 'line1\r' !== 'line1' — so this shows as +1 -1
      expect(result).not.toBeNull()
      if (result) {
        expect(result.added).toBe(1)
        expect(result.removed).toBe(1)
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// CRITICAL TESTING: extractToolSummary
//
// CONTRACT: "Extract a short summary string from a tool call's name and args"
// AUDIT: The function takes `unknown` args and casts it. It silently
//   defaults missing properties to empty string. The contract doesn't
//   specify what happens with malformed, oversized, or hostile args.
// ═══════════════════════════════════════════════════════════════════════

describe('extractToolSummary — Contract Violations', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Name vs Reality
  // ═══════════════════════════════════════════════════════════════════════

  describe('Name vs Reality: read with offset assumption', () => {
    it('read with offset but no path should produce meaningful fallback, not colon-prefixed nonsense', () => {
      // The function doesn't validate that path exists before appending offset.
      // Result is ":10" which looks broken.
      // CORRECT behavior: when path is missing but offset is present,
      // the function should return a meaningful fallback like "read (offset 10)".
      // Marked as contract violation: function should produce a meaningful fallback.
      // Now fixed — returns "read (offset N)" when path is missing but offset is present.
      expect(extractToolSummary('read', { offset: 10 })).toBe('read (offset 10)')
      // CONTRACT VIOLATION: The function produces visually broken output
      // when path is missing but offset is present.
    })

    it('read with limit but no offset — offset not included in summary', () => {
      // The code does: if (a.offset) s += `:${a.offset}` then if (a.limit) s += `-${...}`
      // When offset is undefined/missing, the colon is not added,
      // but the limit range IS appended with a dash.
      // This produces '/f-21' which looks like a file named 'f-21', not a range.
      // AMBIGUITY: The output format assumes offset is always present when limit is,
      // but the code allows limit without offset.
      expect(extractToolSummary('read', { path: '/f', limit: 20 })).toBe('/f-21')
      // This output is confusing — it looks like a filename with a dash, not a range.
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Argument Boundary — hostile inputs
  // ═══════════════════════════════════════════════════════════════════════

  describe('Argument Boundary: what happens with special string values?', () => {
    it('bash with command that is 0 characters returns empty string', () => {
      expect(extractToolSummary('bash', { command: '' })).toBe('')
    })

    it('bash with command that is exactly 80 characters — not truncated', () => {
      const cmd = 'x'.repeat(80)
      expect(extractToolSummary('bash', { command: cmd })).toBe(cmd)
    })

    it('bash with command that is 81 characters — truncated to 80', () => {
      const cmd = 'x'.repeat(81)
      expect(extractToolSummary('bash', { command: cmd })).toBe('x'.repeat(80))
    })

    it('ask_user with question exactly 60 chars — not truncated', () => {
      const q = 'q'.repeat(60)
      expect(extractToolSummary('ask_user', { question: q })).toBe(q)
    })

    it('ask_user with question 61 chars — truncated to 60', () => {
      const q = 'q'.repeat(61)
      expect(extractToolSummary('ask_user', { question: q })).toBe('q'.repeat(60))
    })

    it('path with special characters (spaces, unicode) passes through', () => {
      expect(extractToolSummary('write', { path: '/路径/文件 名.txt', content: 'hi' })).toBe('/路径/文件 名.txt')
    })

    it('path with newlines — passes through, possibly breaking display', () => {
      expect(extractToolSummary('write', { path: '/foo\nbar', content: 'hi' })).toBe('/foo\nbar')
      // A newline in a path is technically invalid but the function doesn't sanitize.
    })
  })

  describe('Argument Boundary: non-string values where strings expected', () => {
    it('read with path as a number — String(42) = "42"', () => {
      expect(extractToolSummary('read', { path: 42 })).toBe('42')
    })

    it('read with path as null — String(null) = "null"', () => {
      // The code does: String(a.path ?? '') — null ?? '' = '', so it returns ''
      expect(extractToolSummary('read', { path: null })).toBe('')
    })

    it('read with path as boolean — String(true) never happens due to ??', () => {
      // true ?? '' = true (truthy), then String(true) = "true"
      expect(extractToolSummary('read', { path: true })).toBe('true')
      // "true" as a file path is nonsense but the function doesn't complain.
    })

    it('bash with command as a number — String(42) then split', () => {
      expect(extractToolSummary('bash', { command: 42 })).toBe('42')
    })

    it('lsp with action as number — stringified', () => {
      // `${a.action ?? ''} ${a.file ?? ''}` — number becomes "42 /f"
      expect(extractToolSummary('lsp', { action: 42, file: '/f' })).toBe('42 /f')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Abstraction Ambiguity — the default case
  // ═══════════════════════════════════════════════════════════════════════

  describe('Abstraction Ambiguity: default case picks first string value', () => {
    it('picks the first string value — but "first" depends on Object.values order', () => {
      // Object.values order is insertion order for string keys, integer keys first.
      // This is an implicit dependency on V8's property enumeration order.
      const result = extractToolSummary('custom_tool', { z: 'last', a: 'first' })
      // Object.values({ z: 'last', a: 'first' }) = ['last', 'first'] (insertion order)
      expect(result).toBe('last')
    })

    it('ignores numeric keys — but JS sorts integer keys first', () => {
      // { 1: 'numeric', b: 'alpha' } — Object.values gives ['numeric', 'alpha']
      const result = extractToolSummary('custom_tool', { 1: 'numeric', b: 'alpha' })
      expect(result).toBe('numeric')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: Error resilience — the try/catch safety net
  // ═══════════════════════════════════════════════════════════════════════

  describe('Error resilience: proxy that throws on access', () => {
    it('handles args that throw on property access — returns empty string', () => {
      const proxy = new Proxy({}, {
        get() { throw new Error('nope') }
      })
      expect(extractToolSummary('read', proxy)).toBe('')
    })

    it('handles args that throw on Object.values — returns empty string', () => {
      const proxy = new Proxy({}, {
        get(target, prop) {
          if (prop === Symbol.iterator || prop === 'length') throw new Error('nope')
          throw new Error('nope')
        }
      })
      expect(extractToolSummary('custom', proxy)).toBe('')
    })
  })

  describe('Non-object args', () => {
    it('string args — treated as empty object', () => {
      expect(extractToolSummary('read', 'not-an-object')).toBe('')
    })

    it('number args — treated as empty object', () => {
      expect(extractToolSummary('read', 42)).toBe('')
    })

    it('undefined args — treated as empty object', () => {
      expect(extractToolSummary('read', undefined)).toBe('')
    })

    it('null args — treated as empty object', () => {
      expect(extractToolSummary('read', null)).toBe('')
    })

    it('array args — arrays are objects, could produce unexpected results', () => {
      // Arrays are objects. Object.values(['a', 'b']) = ['a', 'b']
      // For the default case, this would return 'a' (first string value)
      expect(extractToolSummary('custom_tool', ['hello', 'world'])).toBe('hello')
    })
  })
})
