const { spawn } = require('node:child_process')
const path = require('node:path')

const cli = path.join(path.dirname(require.resolve('electron-vite')), 'cli.js')
const args = ['dev', ...process.argv.slice(2)]

// Linux development checkouts on mounted Windows drives cannot provide the
// setuid permissions Chromium needs, and AppArmor may also block user namespaces.
// This flag applies only to the development launcher, never packaged builds.
if (process.platform === 'linux') {
  if (!args.includes('--')) args.push('--')
  args.push('--no-sandbox')
}

const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit' })
child.on('error', (error) => {
  console.error('[dev] Failed to start electron-vite:', error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
