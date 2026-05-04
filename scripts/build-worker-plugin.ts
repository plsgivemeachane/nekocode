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
      // Polyfill require, __filename, __dirname for bundled CJS code running in ESM context.
      // Without this, any bundled dependency that uses require('os') or similar
      // will throw "Dynamic require of X is not supported" at runtime.
      banner: {
        js: `import { createRequire as __nekocode_banner_cr } from 'module';
var __nekocode_banner_req = __nekocode_banner_cr(import.meta.url);
var require = __nekocode_banner_req;
var __filename = __nekocode_banner_req('url').fileURLToPath(import.meta.url);
var __dirname = __nekocode_banner_req('path').dirname(__filename);`,
      },
      external: [
        // Don't bundle native modules
        '@napi-rs/*',
        'electron',
        // Bundle the SDK with the worker to avoid module resolution issues
        // in production where the SDK is inside app.asar but the worker is outside
        // '@mariozechner/pi-coding-agent', // NOW BUNDLED
        // Don't bundle winston and its dependencies - they use dynamic require('util')
        // which doesn't work in ESM bundled code (see @colors/colors)
        // Note: winston is not used in worker threads (SimpleConsoleLogger is used instead)
        'winston',
        'winston-daily-rotate-file',
        'logform',
        '@colors/colors',
      ],
      // Handle WASM files by copying them to the output directory
      loader: {
        '.wasm': 'copy',
      },
      // Minify in production
      minify: process.env.NODE_ENV === 'production',
    })
    
    console.log('[build-worker] Successfully built worker-bootstrap.js')
  } catch (error) {
    console.error('[build-worker] Failed to build worker-bootstrap.js:', error)
    throw error
  }
}
