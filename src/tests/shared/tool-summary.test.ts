import { describe, it, expect } from 'vitest'
import { extractToolSummary } from '@/renderer/src/components/chat/tool-summary'

describe('extractToolSummary', () => {
  it('strips toolcall_ prefix', () => {
    expect(extractToolSummary('toolcall_read', { path: '/foo' })).toBe('/foo')
  })

  describe('read', () => {
    it('returns path', () => {
      expect(extractToolSummary('read', { path: '/src/index.ts' })).toBe('/src/index.ts')
    })
    it('appends offset', () => {
      expect(extractToolSummary('read', { path: '/f', offset: 10 })).toBe('/f:10')
    })
    it('appends offset and limit as range', () => {
      expect(extractToolSummary('read', { path: '/f', offset: 5, limit: 20 })).toBe('/f:5-25')
    })
    it('handles missing path', () => {
      expect(extractToolSummary('read', {})).toBe('')
    })
    it('handles null args', () => {
      expect(extractToolSummary('read', null)).toBe('')
    })
  })

  describe('write', () => {
    it('returns path', () => {
      expect(extractToolSummary('write', { path: '/out/file.txt', content: 'hello' })).toBe('/out/file.txt')
    })
  })

  describe('edit', () => {
    it('returns path', () => {
      expect(extractToolSummary('edit', { path: '/src/main.ts', edits: [] })).toBe('/src/main.ts')
    })
  })

  describe('bash', () => {
    it('returns first line truncated to 80 chars', () => {
      const longCmd = 'x'.repeat(200)
      expect(extractToolSummary('bash', { command: longCmd })).toBe('x'.repeat(80))
    })
    it('returns first line only', () => {
      expect(extractToolSummary('bash', { command: 'line1\nline2\nline3' })).toBe('line1')
    })
    it('handles missing command', () => {
      expect(extractToolSummary('bash', {})).toBe('')
    })
  })

  describe('powershell', () => {
    it('returns first line truncated to 80 chars', () => {
      const longCmd = 'y'.repeat(200)
      expect(extractToolSummary('powershell', { command: longCmd })).toBe('y'.repeat(80))
    })
  })

  describe('file_skeleton', () => {
    it('returns path', () => {
      expect(extractToolSummary('file_skeleton', { path: '/src/main.ts' })).toBe('/src/main.ts')
    })
  })

  describe('repo_map', () => {
    it('returns keywords', () => {
      expect(extractToolSummary('repo_map', { keywords: 'auth, login' })).toBe('auth, login')
    })
  })

  describe('lsp', () => {
    it('returns action and file trimmed', () => {
      expect(extractToolSummary('lsp', { action: 'definition', file: '/src/main.ts' })).toBe('definition /src/main.ts')
    })
    it('handles missing fields', () => {
      expect(extractToolSummary('lsp', {})).toBe('')
    })
  })

  describe('tilldone', () => {
    it('prefers text over action', () => {
      expect(extractToolSummary('tilldone', { text: 'my task', action: 'add' })).toBe('my task')
    })
    it('falls back to action', () => {
      expect(extractToolSummary('tilldone', { action: 'list' })).toBe('list')
    })
  })

  describe('context_tag', () => {
    it('returns name', () => {
      expect(extractToolSummary('context_tag', { name: 'v1-stable' })).toBe('v1-stable')
    })
  })

  describe('context_log', () => {
    it('returns empty string', () => {
      expect(extractToolSummary('context_log', { limit: 50 })).toBe('')
    })
  })

  describe('context_checkout', () => {
    it('returns target', () => {
      expect(extractToolSummary('context_checkout', { target: 'task-start' })).toBe('task-start')
    })
  })

  describe('ask_user', () => {
    it('truncates question to 60 chars', () => {
      const long = 'q'.repeat(100)
      expect(extractToolSummary('ask_user', { question: long })).toBe('q'.repeat(60))
    })
  })

  describe('empty-summary tools', () => {
    it('detect_package_manager returns empty', () => {
      expect(extractToolSummary('detect_package_manager', {})).toBe('')
    })
    it('pi_version returns empty', () => {
      expect(extractToolSummary('pi_version', {})).toBe('')
    })
    it('pi_docs returns empty', () => {
      expect(extractToolSummary('pi_docs', {})).toBe('')
    })
    it('pi_changelog_versions returns empty', () => {
      expect(extractToolSummary('pi_changelog_versions', {})).toBe('')
    })
  })

  describe('pi_changelog', () => {
    it('returns version or latest', () => {
      expect(extractToolSummary('pi_changelog', { version: '1.2.0' })).toBe('1.2.0')
      expect(extractToolSummary('pi_changelog', {})).toBe('latest')
    })
  })

  describe('default (unknown tool)', () => {
    it('returns first string value truncated to 80', () => {
      expect(extractToolSummary('unknown_tool', { foo: 'bar', baz: 'qux' })).toBe('bar')
    })
    it('returns empty for non-string values', () => {
      expect(extractToolSummary('unknown_tool', { count: 42, flag: true })).toBe('')
    })
    it('returns empty for empty object', () => {
      expect(extractToolSummary('unknown_tool', {})).toBe('')
    })
  })

  describe('edge cases', () => {
    it('handles non-object args', () => {
      expect(extractToolSummary('read', 'not-an-object')).toBe('')
      expect(extractToolSummary('read', 42)).toBe('')
      expect(extractToolSummary('read', undefined)).toBe('')
    })
    it('handles args that throw on property access', () => {
      const proxy = new Proxy({}, {
        get() { throw new Error('nope') }
      })
      expect(extractToolSummary('read', proxy)).toBe('')
    })
  })
})
