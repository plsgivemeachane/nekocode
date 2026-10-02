const { copyFile, rename, chmod } = require('node:fs/promises')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux' ||
      !context.targets.some((target) => target.name.toLowerCase() === 'appimage')) return

  // Keep the launcher ahead of Electron's native sandbox initialization: this
  // fatal error occurs before any code in src/main/index.ts can run.
  const executable = context.packager.executableName
  if (executable !== 'nekocode') throw new Error(`Unsupported AppImage executable name: ${executable}`)
  const binary = join(context.appOutDir, executable)
  await rename(binary, `${binary}.bin`)
  await copyFile(join(__dirname, 'linux-appimage-launcher.sh'), binary)
  await chmod(binary, 0o755)
}
