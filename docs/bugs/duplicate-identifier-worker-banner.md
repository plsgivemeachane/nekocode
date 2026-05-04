# Duplicate Identifier Error in Worker Banner Code

## Bug Description

Worker threads crashed on startup with `SyntaxError: Identifier already declared`. This occurred in two rounds:

1. First: `Identifier '_dirname' has already been declared`
2. Second (after partial fix): `Identifier 'createRequire' has already been declared`

The workers would crash, respawn, crash again in an infinite loop, rendering the app unusable.

## Root Cause

The build scripts (`scripts/build-worker.cjs` and `scripts/build-worker-plugin.ts`) prepend a banner of ESM import statements to the top of the bundled worker code. This banner provides CJS compatibility shims (`require`, `__filename`, `__dirname`) for ESM worker threads.

The banner used bare or minimally-aliased import identifiers that collided with identical imports in the bundled code.

### Original broken banner:

    import { createRequire } from 'module';
    import { fileURLToPath as _fileURLToPath } from 'url';
    import { dirname as _dirname } from 'path';
    const _filename = _fileURLToPath(import.meta.url);
    const _dirname = _dirname(_filename);            // BUG: _dirname already declared via import
    var require = createRequire(_filename);           // BUG: createRequire collides with bundled import
    var __filename = _filename;
    var __dirname = _dirname;

### Problems:

1. `_dirname` was used both as an import alias (`dirname as _dirname`) and as a `const` declaration (`const _dirname = ...`) — you can't redeclare an import-bound identifier.

2. `createRequire` was imported without an alias, but the bundled code (from esbuild) also contained `import { createRequire } from "node:module"` — two bare `createRequire` imports in the same module scope is a SyntaxError in ESM.

3. Even with aliasing, using short prefixes like `_pathDirname` or `__banner_createRequire` is fragile — any future bundled dependency could introduce a collision.

## Fix

The banner was refactored to use a **single import** with a unique namespace prefix, then derive everything else via `require()`:

    import { createRequire as __nekocode_banner_cr } from 'module';
    var __nekocode_banner_req = __nekocode_banner_cr(import.meta.url);
    var require = __nekocode_banner_req;
    var __filename = __nekocode_banner_req('url').fileURLToPath(import.meta.url);
    var __dirname = __nekocode_banner_req('path').dirname(__filename);

### Why this is robust:

1. **Single import** — only `__nekocode_banner_cr` is declared as an import identifier, minimizing collision surface.
2. **Unique namespace** — `__nekocode_banner_` prefix is extremely unlikely to appear in any bundled dependency.
3. **No re-imports** — `fileURLToPath` and `dirname` are obtained via `require()` calls instead of ESM imports, so they can never collide with bundled import statements.
4. **`var` not `const`** — `var` declarations allow redeclaration in the same scope (unlike `const`/`let`), and esbuild's own runtime helpers use `var` for the same reason.

## Files Changed

- `scripts/build-worker.cjs` — Standalone build script (the one actually executed by `bun run build:worker`)
- `scripts/build-worker-plugin.ts` — Vite plugin version (used during `electron-vite build`)

Both files had identical banner code with the same bugs.

## Lesson Learned

When prepending banner code to bundled output:
1. **Minimize imports** — use a single import and derive everything from it.
2. **Namespace aggressively** — use long, unique prefixes that no bundled dependency would use.
3. **Prefer `require()` over ESM imports** in banner code — `require()` calls are function calls, not declarations, so they can never cause identifier collisions.
4. **Never reuse identifiers** — don't use the same name for both an import alias and a variable declaration.