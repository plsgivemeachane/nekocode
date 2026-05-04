/**
 * Build script for worker-bootstrap.js
 * 
 * This script compiles the worker-bootstrap.ts file separately from the main
 * electron-vite build. Worker threads need their entry point as a separate
 * file that can be loaded by Node.js worker_threads.
 * 
 * This is a common pattern for Electron apps that use bundlers like Vite.
 */

const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

const projectRoot = path.resolve(__dirname, '..')
const workerSrc = path.join(projectRoot, 'src/main/threading/worker-bootstrap.ts')
// Output to a separate 'workers' directory that won't be wiped by electron-vite
const workerOut = path.join(projectRoot, 'workers/worker-bootstrap.mjs')

async function buildWorker() {
  console.log('[build-worker] Building worker-bootstrap.js...')
  
  // Ensure output directory exists
  const outDir = path.dirname(workerOut)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }
  
  try {
    await esbuild.build({
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

    // Post-build validation: verify the banner is present and the file
    // starts with the expected require polyfill. If the banner is missing,
    // CJS dependencies like supports-color will fail with
    // 'Dynamic require of "os" is not supported' at runtime.
    const builtContent = fs.readFileSync(workerOut, 'utf8')
    if (!builtContent.startsWith('import { createRequire as __nekocode_banner_cr }')) {
      console.error('[build-worker] Banner validation failed: worker file does not start with expected require polyfill banner')
      console.error('[build-worker] This will cause runtime errors like "Dynamic require of X is not supported"')
      process.exit(1)
    }
    if (!builtContent.includes('var require = __nekocode_banner_req;')) {
      console.error('[build-worker] Banner validation failed: require polyfill assignment not found')
      process.exit(1)
    }
    console.log('[build-worker] Banner validation passed')

    // Copy SDK static assets to workers/pi-package/ so the bundled SDK
    // can find its package.json, README, docs, changelog, etc. at runtime.
    // Without this, getPackageDir() walks up from __dirname (workers/)
    // and fails with ENOENT because there's no package.json there.
    // Worker threads can't read from inside app.asar, so we need real files on disk.
    copySdkStaticAssets(outDir)
  } catch (error) {
    console.error('[build-worker] Failed to build worker-bootstrap.js:', error)
    process.exit(1)
  }
}

/**
 * Copy SDK static assets that getPackageDir() needs at runtime.
 * These are files the SDK reads dynamically (not bundled by esbuild):
 * - package.json (version info, pi_docs listing)
 * - README.md, docs/, examples/ (pi_docs)
 * - CHANGELOG.md (pi_changelog)
 */
function copySdkStaticAssets(targetDir) {
  const sdkPkgDir = path.join(
    projectRoot,
    'node_modules/@mariozechner/pi-coding-agent'
  )
  const piPackageDir = path.join(targetDir, 'pi-package')

  if (!fs.existsSync(sdkPkgDir)) {
    console.warn('[build-worker] SDK package not found, skipping static asset copy')
    return
  }

  // Clean previous copy
  if (fs.existsSync(piPackageDir)) {
    fs.rmSync(piPackageDir, { recursive: true })
  }
  fs.mkdirSync(piPackageDir, { recursive: true })

  // List of files/dirs to copy from the SDK package root
  const staticAssets = ['package.json', 'README.md', 'CHANGELOG.md', 'docs', 'examples']
  let copied = 0
  for (const asset of staticAssets) {
    const src = path.join(sdkPkgDir, asset)
    const dst = path.join(piPackageDir, asset)
    if (fs.existsSync(src)) {
      const stat = fs.statSync(src)
      if (stat.isDirectory()) {
        copyDirRecursive(src, dst)
      } else {
        fs.copyFileSync(src, dst)
      }
      copied++
    }
  }
  console.log(`[build-worker] Copied ${copied} SDK static asset(s) to pi-package/`)

  // Verify that package.json exists in pi-package - it's critical for the SDK
  // to find its package directory at runtime. Without it, getPackageDir()
  // falls back to walking up from __dirname and fails with ENOENT.
  const pkgJsonPath = path.join(piPackageDir, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) {
    console.error('[build-worker] package.json not found in pi-package/!')
    console.error('[build-worker] The SDK will not be able to resolve its package directory at runtime.')
    console.error('[build-worker] This will cause ENOENT errors when loading the worker.')
    process.exit(1)
  }
  console.log('[build-worker] pi-package/package.json validation passed')
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    const srcEntry = path.join(src, entry)
    const dstEntry = path.join(dst, entry)
    const stat = fs.statSync(srcEntry)
    if (stat.isDirectory()) {
      copyDirRecursive(srcEntry, dstEntry)
    } else {
      fs.copyFileSync(srcEntry, dstEntry)
    }
  }
}

buildWorker()
