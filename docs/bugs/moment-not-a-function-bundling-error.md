# moment is not a function - Bundling Error

## Bug Description

When launching the packaged NekoCode app, a JavaScript error occurred in the main process:

```
TypeError: moment is not a function
    at FileStreamRotator.getDate (out/main/index.js:166803:44)
    at FileStreamRotator.getStream (out/main/index.js:167034:61)
    at new DailyRotateFile (out/main/index.js:167243:49)
```

The app crashed immediately on startup, making it completely unusable.

## Root Cause

The `winston-daily-rotate-file` package depends on `file-stream-rotator`, which in turn depends on `moment`. The `moment` library uses a CommonJS pattern where `module.exports` is a function:

```js
module.exports = function(input, format, lang, strict) { ... }
```

When electron-vite bundles the main process, it auto-externalizes only **direct** dependencies listed in `package.json`'s `dependencies` field. Since `moment` is a **transitive** dependency (not listed directly in `package.json`), esbuild attempted to bundle it inline. During bundling, esbuild's CJS-to-ESM interop layer mangled `moment`'s default export — transforming the function export into an object. At runtime, `file-stream-rotator` called `moment()` as a function, but received an object instead, causing the `TypeError`.

The dependency chain was:
```
winston-daily-rotate-file (direct dep, auto-externalized by electron-vite)
  └── file-stream-rotator (transitive dep, bundled inline)
        └── moment (transitive dep, bundled inline — CJS export mangled)
```

## Fix Applied

Added `moment` and `file-stream-rotator` to the `rollupOptions.external` array in `electron.vite.config.ts`. This prevents esbuild from bundling these modules inline, instead emitting `require()` calls that resolve from `node_modules` at runtime where the CJS semantics are preserved correctly.

### electron.vite.config.ts

Added build configuration to the `main` section:

```ts
build: {
  rollupOptions: {
    external: ['moment', 'file-stream-rotator'],
  },
},
```

With this change, `file-stream-rotator` is loaded from `node_modules` at runtime, and its internal `require('moment')` call also resolves correctly from `node_modules`. Both modules maintain their proper CJS exports.

## Files Changed

- `electron.vite.config.ts` - Added `moment` and `file-stream-rotator` to main process build externals

## Verification

- Build completes successfully
- All 620 tests pass
- Lint passes with no errors
- Type-check passes
- The bundled `out/main/index.js` contains `require("file-stream-rotator")` as an external call (line 163571)
- No `moment` code is bundled inline (verified by searching for `moment.fn`, `moment.prototype`, `function moment(` patterns)
