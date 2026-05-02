/**
 * Build plugin for worker-bootstrap.js
 * 
 * This module provides a buildWorker function that can be called from a Vite plugin
 * to build the worker-bootstrap.js file after the main electron-vite build completes.
 */

import * as esbuild from 'esbuild'
import * as path from 'path'
import * as fs from 'fs'

const projectRoot = path.resolve(__dirname, '..')
const workerSrc = path.join(projectRoot, 'src/main/threading/worker-bootstrap.ts')
// Output to a separate 'workers' directory that won't be wiped by electron-vite
const workerOut = path.join(projectRoot, 'workers/worker-bootstrap.mjs')

export function buildWorker(): void {
  console.log('[build-worker] Building worker-bootstrap.js...')
  
  // Ensure output directory exists
  const outDir = path.dirname(workerOut)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }
  
  try {
    // Use esbuild sync API for use in Vite plugin hooks
    esbuild.buildSync({
      entryPoints: [workerSrc],
      outfile: workerOut,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: false,
      external: [
        // Don't bundle native modules
        '@napi-rs/*',
        'electron',
        // Don't bundle the SDK - it needs to be dynamically imported at runtime
        // to avoid issues with worker thread module resolution
        '@mariozechner/pi-coding-agent',
        // Don't bundle winston and its dependencies - they use dynamic require('util')
        // which doesn't work in ESM bundled code (see @colors/colors)
        'winston',
        'winston-daily-rotate-file',
        'logform',
        '@colors/colors',
      ],
      // Minify in production
      minify: process.env.NODE_ENV === 'production',
    })
    
    console.log('[build-worker] Successfully built worker-bootstrap.js')
  } catch (error) {
    console.error('[build-worker] Failed to build worker-bootstrap.js:', error)
    throw error
  }
}
