import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
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
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@earendil-works/pi-coding-agent'],
      }),
      buildWorkerPlugin(),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  }
})
