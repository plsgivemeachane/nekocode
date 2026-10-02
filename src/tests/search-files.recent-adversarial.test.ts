import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { searchFiles } from '../main/search-files'

describe('searchFiles recent adversarial cases', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('robustness policy: clamps a negative result limit to zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nekocode-search-'))
    roots.push(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'one.ts'), '')
    await writeFile(join(root, 'src', 'two.ts'), '')

    const results = await searchFiles({ projectPath: root, query: '', limit: -1 })

    expect(results).toEqual([])
  })

  it('supports the zero and one result boundaries while excluding default directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nekocode-search-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'hidden.ts'), '')
    await writeFile(join(root, 'z.ts'), '')
    await writeFile(join(root, 'a.ts'), '')

    expect(await searchFiles({ projectPath: root, query: '', limit: 0 })).toEqual([])
    const results = await searchFiles({ projectPath: root, query: '', limit: 1 })
    expect(results).toHaveLength(1)
    expect(results[0]!.relativePath).toBe('a.ts')
    expect(results.some((entry) => entry.relativePath.includes('node_modules'))).toBe(false)
  })
})
