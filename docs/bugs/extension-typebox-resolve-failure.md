# Extension Load Failure: `Cannot find module '@sinclair/typebox'` in Bundled Worker

> **Status:** Fixed
> **Affected:** NekoCode production builds (worker-bootstrap.mjs)
> **Date:** 2026-05-04

---

## 1. Phenomenon

All 19 extensions fail to load during session reconnect with the same error:

    Cannot find module '@sinclair/typebox'
    Require stack:
    - C:\Program Files\Nekocode\resources\workers\worker-bootstrap.mjs

Error count: Extensions loaded: 0, errors: 19

---

## 2. Root Cause

The SDK's getAliases() function in loader.js calls equire.resolve("@sinclair/typebox")
at line 49 **without try/catch**. This call resolves the typebox package path from the
filesystem to build an alias map for jiti.

In the bundled worker context (worker-bootstrap.mjs), esbuild inlines all dependencies
(including @sinclair/typebox) into a single file. There is no 
ode_modules directory on
disk at the worker's location (C:\Program Files\Nekocode\resources\workers\), so
equire.resolve("@sinclair/typebox") throws Cannot find module.

The alias map was redundant in this context because VIRTUAL_MODULES (which includes
@sinclair/typebox as a bundled import) is already passed to jiti's irtualModules option.

### Call chain

    DefaultResourceLoader.reload()
      -> loadExtensions()
        -> loadExtensionModule()
          -> getAliases()
            -> require.resolve("@sinclair/typebox")  // THROWS: module not on disk

---

## 3. Fix

Updated the SDK patch (patches/@mariozechner+pi-coding-agent+0.64.0.patch) to wrap
equire.resolve("@sinclair/typebox") in a try/catch block. When resolution fails (bundled
context), 	ypeboxRoot defaults to "" and the alias is skipped — jiti resolves typebox
through irtualModules instead.

### Before (in loader.js):

    const typeboxEntry = require.resolve("@sinclair/typebox");
    const typeboxRoot = typeboxEntry.replace(/[\\\/]build[\\\/]cjs[\\\/]index\.js$/, "");

### After:

    let typeboxRoot = "";
    try {
        const typeboxEntry = require.resolve("@sinclair/typebox");
        typeboxRoot = typeboxEntry.replace(/[\\\/]build[\\\/]cjs[\\\/]index\.js$/, "");
    } catch {}

---

## 4. Why This Only Affects Production

In development, the worker runs from the project directory where 
ode_modules is present,
so equire.resolve("@sinclair/typebox") succeeds. In production, the worker is a bundled
ESM file deployed to esources/workers/ with no 
ode_modules.

---

## 5. Verification

- Worker rebuild: 
ode ./scripts/build-worker.cjs — passed
- Tests: un run test — 27 files, 619 tests passed
- Lint: un run lint — clean
- Type check: un run type-check — clean
