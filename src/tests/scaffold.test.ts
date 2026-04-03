import { describe, it, expect } from 'vitest'

describe('project scaffold', () => {
  it('package.json has correct name and scripts', async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } })
    expect(pkg.default.name).toBe('nekocode')
    expect(pkg.default.scripts.dev).toContain('electron-vite dev')
    expect(pkg.default.scripts.test).toContain('vitest')
  })
})
