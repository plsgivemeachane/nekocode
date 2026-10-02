import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { getDevArgs } = require('../../scripts/dev.cjs') as {
  getDevArgs: (platform: string, stat: { uid: number; mode: number } | undefined, args: string[]) => string[]
}

describe('development Electron sandbox arguments', () => {
  it.each([
    { uid: 65534, mode: 0o100777 },
    { uid: 1000, mode: 0o104755 },
    { uid: 0, mode: 0o100755 },
    { uid: 0, mode: 0o104777 },
  ])('bypasses a misconfigured Linux helper: %j', (stat) => {
    expect(getDevArgs('linux', stat, [])).toEqual(['dev', '--noSandbox'])
  })

  it('keeps sandboxing when the Linux helper is correctly configured', () => {
    expect(getDevArgs('linux', { uid: 0, mode: 0o104755 }, [])).toEqual(['dev'])
  })

  it('allows the native fallback when the Linux helper is absent', () => {
    expect(getDevArgs('linux', undefined, [])).toEqual(['dev'])
  })

  it.each(['win32', 'darwin'])('preserves sandboxing on %s', (platform) => {
    expect(getDevArgs(platform, { uid: 1000, mode: 0o100777 }, [])).toEqual(['dev'])
  })

  it('forwards CLI options and Electron arguments unchanged', () => {
    expect(getDevArgs('linux', { uid: 1000, mode: 0o100777 }, ['--watch', '--', '--lang=en']))
      .toEqual(['dev', '--noSandbox', '--watch', '--', '--lang=en'])
  })
})
