import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { buildWorker } from './scripts/build-worker-plugin'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

/**
 * Vite plugin to build the worker-bootstrap.js file after the main build completes.
 * This is needed because electron-vite wipes the out/ directory during build,
 * so we need to build the worker AFTER the main build finishes.
 */
function buildWorkerPlugin(): Plugin {
  return {
    name: 'build-worker',
    // Use closeBundle hook to run after the build is complete
    closeBundle() {
      buildWorker()
    },
  }
}

export default defineConfig({
  main: {
    plugins: [buildWorkerPlugin()],
    build: {
      rollupOptions: {
        // Externalize moment and file-stream-rotator to prevent esbuild from mangling
        // moment's CJS default export (module.exports = function).
        // These are transitive dependencies of winston-daily-rotate-file that electron-vite
        // doesn't auto-externalize (only direct dependencies are auto-externalized).
        external: ['moment', 'file-stream-rotator'],
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  }
})
