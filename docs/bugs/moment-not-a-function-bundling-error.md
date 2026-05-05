# moment is not a function - Bundling Error

## Symptom

When launching the packaged NekoCode Electron app (production build installed via NSIS/portable), a fatal uncaught exception dialog appears immediately on startup:

```
TypeError: moment is not a function
    at require_chunk.__commonJSMin.FileStreamRotator.getDate
        (C:\Program Files\Nekocode\resources\app.asar\out\main\index.js:166803:44)
    at require_chunk.__commonJSMin.FileStreamRotator.getStream
        (C:\Program Files\Nekocode\resources\app.asar\out\main\index.js:167034:61)
    at new DailyRotateFile
        (C:\Program Files\Nekocode\resources\app.asar\out\main\index.js:167243:49)
    at Module.<anonymous>
        (C:\Program Files\Nekocode\resources\app.asar\out\main\index.js:167584:3)
```

The app is completely unusable — it crashes before rendering any window.

---

## Full Dependency Chain (for context)

The call chain that triggers the error:

1. **`src/main/logger.ts`** — The app's main-thread logger initializes Winston with a `DailyRotateFile` transport:
   ```ts
   DailyRotateFile = require('winston-daily-rotate-file')
   // ...
   new DailyRotateFile({
       dirname: getLogDir(),
       filename: 'nekocode-%DATE%.log',
       datePattern: 'YYYY-MM-DD',
       // ...
   })
   ```

2. **`winston-daily-rotate-file` (v5.0.0)** — This Winston transport delegates file stream creation to `file-stream-rotator`:
   ```js
   // node_modules/winston-daily-rotate-file/daily-rotate-file.js line 81
   this.logStream = require("file-stream-rotator").getStream({ ... });
   ```

3. **`file-stream-rotator` (v0.6.1)** — This package uses `moment` for date formatting:
   ```js
   // node_modules/file-stream-rotator/FileStreamRotator.js line 15
   var moment = require('moment');
   ```
   And calls `moment` as a function in `getDate()` at line 177:
   ```js
   let currentMoment = utc ? moment.utc() : moment().local()
   ```

4. **`moment` (v2.30.1)** — Exports a function via the CJS pattern:
   ```js
   // node_modules/moment/moment.js line 8
   typeof exports === 'object' && typeof module !== 'undefined'
       ? module.exports = factory()
       // ...
   ```

---

## Root Cause Analysis

### The CJS/ESM interop problem

`moment.js` uses a classic CommonJS pattern where `module.exports` is assigned a **function** (not an object):

```js
module.exports = function(input, format, lang, strict) {
    // ... returns a Moment object
};
module.exports.fn = Moment.prototype;
```

When a bundler (Rollup or esbuild) encounters this CJS module and processes it for ESM-compatible output, its CJS-to-ESM interop layer transforms the export. Instead of preserving the function as the default export, it wraps it in a namespace object:

```js
// What the bundled code effectively becomes:
var moment_exports = {};
__toCommonJS(moment_exports);
// module.exports = factory()  →  moment_exports.default = factory()
moment_exports.default = factory();
```

At runtime, `require('moment')` now returns this namespace object `{ default: [Function] }` instead of the function itself. When `file-stream-rotator` calls `moment()`, it gets `TypeError: moment is not a function` because you can't invoke an object.

The `require_chunk.__commonJSMin` prefix in the stack trace confirms this — `file-stream-rotator` and `moment` are being **bundled inline** into `out/main/index.js`, triggering the CJS interop transformation.

### Why the existing `rollupOptions.external` fix doesn't work

The project already attempted to fix this by adding these modules to Rollup's external list in `electron.vite.config.ts`:

```ts
// electron.vite.config.ts
main: {
    build: {
        rollupOptions: {
            external: ['moment', 'file-stream-rotator'],
        },
    },
},
```

**This fix is ineffective** because of how electron-vite internally configures Vite for the main process build.

electron-vite's main process config plugin (in `node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js`) does the following in order:

1. **Line 280** — Sets its own default `rollupOptions.external`:
   ```js
   external: ['electron', /^electron\/.+/, ...builtinModules.flatMap(m => [m, `node:${m}`])]
   ```

2. **Line 307** — Merges the user's config with the default using Vite's `mergeConfig`:
   ```js
   const buildConfig = mergeConfig(defaultConfig.build, build);
   ```
   Vite's `mergeConfig` **concatenates arrays**, so the result is:
   ```
   external: ['electron', ...builtins, 'moment', 'file-stream-rotator']
   ```
   This part works correctly.

3. **Line 321 — THE PROBLEM** — After the merge, electron-vite forcibly sets:
   ```js
   config.ssr = { ...config.ssr, ...{ noExternal: true } };
   ```
   It also enables SSR mode on lines 318-320:
   ```js
   config.build.ssr = true;
   config.build.ssrEmitAssets = true;
   ```

The `ssr.noExternal: true` tells Vite's SSR build pipeline: **"bundle ALL dependencies — do not externalize any npm package."** This is a Vite-level directive that **takes precedence over `rollupOptions.external`** for node_modules packages. Vite's SSR module resolver processes imports before Rollup sees them, and with `noExternal: true`, it resolves all dependencies for bundling. Only platform builtins (`fs`, `path`, `electron`, etc.) remain external.

So even though `moment` and `file-stream-rotator` are correctly listed in `rollupOptions.external`, Vite's `ssr.noExternal: true` overrides this for npm packages, forcing them to be bundled inline. The CJS interop then mangles `moment`'s function export into an object.

### Summary of the conflict

| Config level | Setting | Effect |
|---|---|---|
| User's `rollupOptions.external` | `['moment', 'file-stream-rotator']` | Tells Rollup: "leave these as `require()` calls" |
| electron-vite's `ssr.noExternal` | `true` (line 321, hardcoded) | Tells Vite SSR: "bundle ALL npm deps, no exceptions" |
| **Winner** | `ssr.noExternal: true` | Vite SSR resolution runs before Rollup; npm deps get bundled regardless |

---

## How to Fix

### The correct approach: use `ssr.external` (NOT `rollupOptions.external`)

In Vite's SSR configuration, `ssr.external` is the mechanism that takes precedence over `ssr.noExternal`. When both `ssr.noExternal: true` and `ssr.external: ['moment']` are set, Vite interprets this as: "bundle everything **except** what's in `ssr.external`."

Change `electron.vite.config.ts` from:

```ts
export default defineConfig({
  main: {
    plugins: [buildWorkerPlugin()],
    build: {
      rollupOptions: {
        // BUG: This is overridden by electron-vite's ssr.noExternal: true
        external: ['moment', 'file-stream-rotator'],
      },
    },
  },
  // ...
})
```

To:

```ts
export default defineConfig({
  main: {
    plugins: [buildWorkerPlugin()],
    build: {
      rollupOptions: {
        external: ['moment', 'file-stream-rotator'],
      },
    },
    // THIS is what actually prevents these modules from being bundled.
    // ssr.external takes precedence over electron-vite's ssr.noExternal: true.
    ssr: {
      external: ['moment', 'file-stream-rotator'],
    },
  },
  // ...
})
```

The `rollupOptions.external` can be kept for belt-and-suspenders, but the `ssr.external` is the one that actually works given electron-vite's forced `ssr.noExternal: true`.

### Why this works

electron-vite's config plugin merges user `ssr` config at line 321:
```js
config.ssr = { ...config.ssr, ...{ noExternal: true } };
```

The spread `...config.ssr` preserves any existing `ssr` properties from the user config, including `ssr.external`. So if the user sets `ssr.external: ['moment', 'file-stream-rotator']`, it survives the merge, and Vite's SSR resolver respects it even when `noExternal: true`.

### Alternative approaches (if the above doesn't work for some Vite version)

1. **Replace `moment` with native `Date`** — Patch `file-stream-rotator` to use `new Date().toISOString()` or a lightweight date formatter instead of moment. This eliminates the problematic CJS module entirely.

2. **Use a different log rotation approach** — Remove `winston-daily-rotate-file` from dependencies and implement simple daily file rotation natively in `logger.ts` (the app already has a `SimpleConsoleLogger` class for worker threads that does exactly this with manual date-based filenames).

3. **Use `externalizeDepsPlugin` from electron-vite** — electron-vite exports an `externalizeDepsPlugin` helper that externalizes all dependencies listed in `package.json`. Add `moment` and `file-stream-rotator` to `package.json` `dependencies` (even as transitive overrides) and use this plugin. However, this approach externalizes ALL deps which may not be desired.

---

## Key Files

| File | Role |
|---|---|
| `electron.vite.config.ts` | Build config — where the external/ssr configuration lives |
| `src/main/logger.ts` | Creates Winston logger with DailyRotateFile transport (lines 165-278) |
| `node_modules/file-stream-rotator/FileStreamRotator.js` | Uses `var moment = require('moment')` at line 15, calls `moment()` at line 177 |
| `node_modules/winston-daily-rotate-file/daily-rotate-file.js` | Requires `file-stream-rotator` at line 81 |
| `node_modules/moment/moment.js` | CJS export: `module.exports = factory()` at line 8 — the function that gets mangled |
| `node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js` | electron-vite's internal config — sets `ssr.noExternal: true` at line 321 |

## Version Information

- `electron-vite`: ^4.0.1
- `winston`: ^3.19.0
- `winston-daily-rotate-file`: ^5.0.0
- `file-stream-rotator`: 0.6.1 (transitive dep)
- `moment`: 2.30.1 (transitive dep)
- `electron`: ^34.0.0
