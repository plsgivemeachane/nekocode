import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { buildWorker } from './scripts/build-worker-plugin'

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
  },
  preload: {},
  renderer: {
    plugins: [tailwindcss()]
  }
})
