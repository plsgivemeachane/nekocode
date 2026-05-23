# Coms Peer List Shows Nothing After Project Name Fix

## Date
2025-05-23

## Bug Description
After fixing the coms extension `--project` flag default from `"default"` to `undefined` (so agents register under their actual project directory name like `nekocode` instead of `default`), the NekoCode peer agents list showed no agents.

## Root Cause
The `ComsManager.list()` method in `src/main/coms-manager.ts` had a hardcoded fallback:

```typescript
const project = payload?.project || 'default'
```

When the renderer calls `window.nekocode.coms.list({})` (no project parameter), `payload.project` is `undefined`, so it fell back to the literal string `'default'`. But agents now register under their actual project name (e.g., `'nekocode'`) derived from `path.basename(ctx.cwd)`. The `list()` method would only scan the `projects/default/agents/` directory, which was empty, while the actual agents were in `projects/nekocode/agents/`.

## The Cascade
1. coms extension fix: `--project` flag `default: "default"` → `default: undefined`
2. Agents now register under `path.basename(ctx.cwd)` (e.g., `nekocode`) instead of `default`
3. `ComsManager.list()` still hardcoded `'default'` as the project filter
4. Result: list scans `projects/default/agents/` → empty → no peers shown

## Fix
Changed the fallback in `ComsManager.list()` to use `this.selfProject` (the project this NekoCode instance is registered under):

```typescript
// Before
const project = payload?.project || 'default'

// After
const project = payload?.project || this.selfProject || 'default'
```

This way, when no explicit project filter is provided, `list()` defaults to scanning the same project that the current NekoCode instance belongs to. The final `'default'` fallback only kicks in if `this.selfProject` hasn't been set yet (shouldn't happen in normal operation).

## Files Changed
- `src/main/coms-manager.ts` — Line 238: Changed project fallback from `'default'` to `this.selfProject || 'default'`

## Testing
- All 1390 tests pass
- Type-check passes
- Lint passes
