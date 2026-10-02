const { statSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { pathToFileURL } = require('node:url')

function getDevArgs(platform, sandboxStat, args) {
  // Mounted Windows filesystems cannot reliably provide a root-owned setuid helper.
  // Limit the workaround to local development with a misconfigured Linux helper.
  const needsFallback = platform === 'linux' && sandboxStat &&
    (sandboxStat.uid !== 0 || (sandboxStat.mode & 0o7777) !== 0o4755)
  return ['dev', ...(needsFallback ? ['--noSandbox'] : []), ...args]
}

async function startDev() {
  let sandboxStat
  if (process.platform === 'linux') {
    const helper = join(dirname(require('electron')), 'chrome-sandbox')
    try {
      sandboxStat = statSync(helper)
    } catch (error) {
      // A missing helper may still allow Chromium's user-namespace sandbox.
      if (error.code !== 'ENOENT') throw error
    }
  }

  const args = getDevArgs(process.platform, sandboxStat, process.argv.slice(2))
  if (args.includes('--noSandbox')) {
    console.warn('[dev] Linux chrome-sandbox is not root-owned with mode 4755; disabling Chromium sandboxing for this development run only.')
  }
  const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
  process.argv = [process.execPath, cli, ...args]
  await import(pathToFileURL(cli).href)
}

module.exports = { getDevArgs }

if (require.main === module) {
  startDev().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
