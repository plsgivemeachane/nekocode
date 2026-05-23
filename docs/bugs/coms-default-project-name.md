# Bug: Coms Extension Shows `@default` Instead of Real Project Name

**Date:** 2026-05-23
**Severity:** Low — cosmetic in status bar, but affects multi-project peer discovery
**Status:** Fixed

## Symptoms

The coms extension's status bar and peer registration always showed:

```
📡 coms ready · agent-6BGN5M@default · default pool
```

Instead of using the actual project name derived from the working directory (e.g. `agent-6BGN5M@nekocode`).

This meant all sessions across different projects joined the same `"default"` pool, making peer discovery less useful in multi-project workflows.

## Root Cause

In `C:\Users\admin\.pi\agent\extensions\coms.ts`, the `--project` CLI flag was registered with `default: "default"`:

```typescript
// Line 545-548
pi.registerFlag("project", {
    description: "Project namespace for peer discovery",
    type: "string",
    default: "default",   // <-- THE BUG
});
```

The project name resolution at line 777 then short-circuited:

```typescript
// Line 777
const project = flags.project || path.basename(ctx.cwd || process.cwd()) || "default";
```

Since `flags.project` was always `"default"` (from the flag default), it was always truthy, and `path.basename(ctx.cwd)` — which would have returned the correct project name — was **never evaluated**.

The `||` fallback chain looks correct at first glance, but the flag default value `"default"` is a truthy string, so the logical OR never reaches the cwd-based resolution.

## Fix

Changed the `--project` flag's `default` from `"default"` to `undefined`:

```typescript
pi.registerFlag("project", {
    description: "Project namespace for peer discovery",
    type: "string",
    default: undefined,   // Now falls through to cwd-based resolution
});
```

Now when `--project` is not explicitly set:
1. `pi.getFlag("project")` returns `undefined`
2. `readCliFlags()` converts it to `undefined` (already handled by the empty-string check)
3. `flags.project` is `undefined` (falsy)
4. `path.basename(ctx.cwd || process.cwd())` is evaluated, returning the actual project directory name
5. Only if that also fails does it fall back to `"default"`

## File Changed

| File | Change |
|------|--------|
| `C:\Users\admin\.pi\agent\extensions\coms.ts` | Changed `--project` flag default from `"default"` to `undefined` |

## Expected Behavior After Fix

When opening NekoCode in `E:/project/node/nekocode`, the status should now show:

```
📡 coms ready · agent-6BGN5M@nekocode · nekocode pool
```

Each project directory will now have its own peer discovery pool instead of everything lumping into `"default"`.
