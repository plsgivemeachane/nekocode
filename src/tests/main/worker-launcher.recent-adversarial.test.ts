import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it, afterEach } from 'vitest'

const require = createRequire(import.meta.url)
const { copySdkStaticAssets } = require('../../../scripts/build-worker.cjs') as {
  copySdkStaticAssets: (target: string, source: string) => { packageDir: string; copied: number }
}
const { getDevArgs } = require('../../../scripts/dev.cjs') as {
  getDevArgs: (platform: string, stat: { uid: number; mode: number } | undefined, args: readonly string[]) => string[]
}
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('worker build and dev launcher failure boundaries', () => {
  it('fails clearly when the SDK directory is absent instead of silently producing a broken worker', async () => {
    const output = await mkdtemp(join(tmpdir(), 'nekocode-worker-output-'))
    roots.push(output)
    expect(() => copySdkStaticAssets(output, join(output, 'missing-sdk'))).toThrow(/SDK package not found/)
  })

  it('fails clearly when the SDK directory has no package metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nekocode-sdk-'))
    const output = await mkdtemp(join(tmpdir(), 'nekocode-worker-output-'))
    roots.push(root, output)
    expect(() => copySdkStaticAssets(output, root)).toThrow(/SDK package metadata not found/)
  })

  it('preserves caller arguments and only disables sandbox for the exact Linux helper failure', () => {
    const args = Object.freeze(['--watch', '--', '--lang=en'])
    const result = getDevArgs('linux', { uid: 1000, mode: 0o100755 }, args)

    expect(result).toEqual(['dev', '--noSandbox', '--watch', '--', '--lang=en'])
    expect(args).toEqual(['--watch', '--', '--lang=en'])
    expect(getDevArgs('linux', { uid: 0, mode: 0o104755 }, args)).toEqual(['dev', ...args])
    expect(getDevArgs('darwin', { uid: 1000, mode: 0o100755 }, args)).toEqual(['dev', ...args])
  })

  it('does not treat a missing helper as a reason to disable sandboxing', () => {
    expect(getDevArgs('linux', undefined, ['--inspect'])).toEqual(['dev', '--inspect'])
  })
})
