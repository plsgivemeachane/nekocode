import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type PackContext = {
  electronPlatformName: string
  appOutDir: string
  targets: { name: string }[]
  packager: { executableName: string }
}
const afterPack = require('../../scripts/after-pack.cjs') as (context: PackContext) => Promise<void>
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(platform = 'linux', target = 'appImage') {
  const root = await mkdtemp(join(tmpdir(), 'nekocode-launcher-'))
  roots.push(root)
  const executable = join(root, 'nekocode')
  // A harmless stand-in records what the real Electron binary would receive.
  const source = '#!/bin/sh\nprintf "%s\\n" "$@"\n'
  await writeFile(executable, source, { mode: 0o755 })
  const context = { electronPlatformName: platform, appOutDir: root,
    targets: [{ name: target }], packager: { executableName: 'nekocode' } }
  return { root, executable, source, context }
}

async function launchEnv(root: string, namespaces = false) {
  const tools = join(root, 'tools')
  await mkdir(tools)
  await writeFile(join(tools, 'unshare'), `#!/bin/sh\nexit ${namespaces ? 0 : 1}\n`, { mode: 0o755 })
  return { ...process.env, PATH: `${tools}:${process.env.PATH}`, APPIMAGE: '/tmp/NekoCode.AppImage' }
}

describe('Linux AppImage native startup wrapper', () => {
  it.each(['win32', 'darwin'])('leaves %s packaging untouched', async (platform) => {
    const { executable, source, context } = await fixture(platform)
    await afterPack(context)
    expect(await readFile(executable, 'utf8')).toBe(source)
  })

  it('leaves other Linux targets untouched', async () => {
    const { executable, source, context } = await fixture('linux', 'deb')
    await afterPack(context)
    expect(await readFile(executable, 'utf8')).toBe(source)
  })

  it.skipIf(process.platform !== 'linux')('passes fallback and exact user arguments to Electron before startup', async () => {
    const { root, executable, source, context } = await fixture()
    await writeFile(join(root, 'chrome-sandbox'), '', { mode: 0o755 })
    await chmod(join(root, 'chrome-sandbox'), 0o755)
    await afterPack(context)
    expect(await readFile(`${executable}.bin`, 'utf8')).toBe(source)
    const args = ['--lang=en', 'a path with spaces', 'literal $(touch unwanted) --no-sandbox text']
    const output = execFileSync(executable, args, {
      env: await launchEnv(root), encoding: 'utf8',
    })
    expect(output.trimEnd().split('\n')).toEqual(['--no-sandbox', ...args])
  })

  it.skipIf(process.platform !== 'linux').each(['--no-sandbox', '--disable-setuid-sandbox'])('preserves an explicit %s flag', async (flag) => {
    const { root, executable, context } = await fixture()
    await writeFile(join(root, 'chrome-sandbox'), '', { mode: 0o755 })
    await afterPack(context)
    expect(execFileSync(executable, [flag, '--lang=en'], {
      env: await launchEnv(root), encoding: 'utf8',
    }).trimEnd().split('\n')).toEqual([flag, '--lang=en'])
  })

  it.skipIf(process.platform !== 'linux')('keeps the namespace sandbox when available', async () => {
    const { root, executable, context } = await fixture()
    await writeFile(join(root, 'chrome-sandbox'), '', { mode: 0o755 })
    await afterPack(context)
    expect(execFileSync(executable, ['--lang=en'], {
      env: await launchEnv(root, true), encoding: 'utf8',
    }).trimEnd().split('\n')).toEqual(['--disable-setuid-sandbox', '--lang=en'])
  })

  it.skipIf(process.platform !== 'linux')('keeps default sandboxing with a valid helper', async () => {
    const { root, executable, context } = await fixture()
    await writeFile(join(root, 'chrome-sandbox'), '', { mode: 0o755 })
    await afterPack(context)
    const env = await launchEnv(root)
    // Simulate root ownership without requiring tests to chown system files.
    await writeFile(join(root, 'tools', 'stat'), '#!/bin/sh\nprintf "0:4755\\n"\n', { mode: 0o755 })
    expect(execFileSync(executable, ['--lang=en'], { env, encoding: 'utf8' }).trimEnd()).toBe('--lang=en')
  })

  it.skipIf(process.platform !== 'linux')('preserves sandboxing outside AppImage and with a missing helper', async () => {
    const { root, executable, context } = await fixture()
    await afterPack(context)
    const run = (appimage: string) => execFileSync(executable, ['--lang=en'], {
      env: { ...process.env, APPIMAGE: appimage }, encoding: 'utf8',
    }).trimEnd()
    expect(run('/tmp/NekoCode.AppImage')).toBe('--lang=en')
    await writeFile(join(root, 'chrome-sandbox'), '', { mode: 0o755 })
    expect(run('')).toBe('--lang=en')
  })
})
