# Bug: extractDiffStats Crashes on Null / Non-Object `edits` Entries

**Date:** 2026-10-30
**Status:** Fixed
**Files Changed:**
- `src/renderer/src/components/chat/tool-summary.ts`
- `src/tests/shared/tool-summary.test.ts`

## Summary

`extractDiffStats` (used by the chat UI to render the diff-stats badge for file
modifying tool calls) crashed with `TypeError: Cannot read properties of null`
when an `edit` tool call's `edits` array contained a `null` (or `undefined`)
entry. Tool-call args are untrusted model output typed as `unknown`, so any
entry shape is possible. The function now skips non-object entries and treats a
non-array `edits` value as "no edits" instead of throwing.

## Symptoms

The renderer throws while computing stats for an edit tool call:

```
TypeError: Cannot read properties of null (reading 'oldText')
    at extractDiffStats (src/renderer/src/components/chat/tool-summary.ts:73)
```

Because this happens during render, the tool-call section (and potentially the
surrounding chat view) fails to render the diff stats.

## Steps to Reproduce

Call `extractDiffStats` with an edit tool whose `edits` array contains a null
entry:

```ts
extractDiffStats('edit', { path: '/f', edits: [null] }, null)
// throws: TypeError: Cannot read properties of null (reading 'oldText')
```

Any of these also crashed:

```ts
extractDiffStats('edit', { path: '/f', edits: [undefined] }, null)
extractDiffStats('edit', { path: '/f', edits: [{ oldText: 'a', newText: 'b' }, null] }, null)
```

## Root Cause

The edit branch iterated the `edits` array and cast each entry directly to
`Record<string, unknown>` without validating it:

```ts
// OLD (BUG) — unchecked cast, then a property read
for (const edit of edits) {
  const e = edit as Record<string, unknown>
  const oldText = typeof e.oldText === 'string' ? e.oldText : ''
  const newText = typeof e.newText === 'string' ? e.newText : ''
  ...
}
```

`Array.isArray(argsObj.edits)` only proves the container is an array — it says
nothing about the entries. A `null` or `undefined` entry cannot be cast into a
usable record; reading `e.oldText` on it throws. The original test at
`src/tests/shared/tool-summary.test.ts` asserted `toThrow()` and documented the
crash as a "REAL BUG", so the suite locked the failure in rather than catching
it.

The top-level `args` value had a related (though non-crashing in practice)
unchecked cast: `args as Record<string, unknown>`. Reading `.content` off a
primitive happens to be safe, but the cast gave no guarantee for future
changes.

## Fix

Added a small type guard and used it to skip invalid entries:

```ts
function isPlainEditObject(edit: unknown): edit is Record<string, unknown> {
  return typeof edit === 'object' && edit !== null && !Array.isArray(edit)
}
```

```ts
for (const edit of edits) {
  // Guard against null/undefined/primitive/array entries in the untrusted
  // tool args. Only plain objects are valid edits; skipping everything else
  // prevents reading a property from null (which throws TypeError).
  if (!isPlainEditObject(edit)) continue
  const e = edit as Record<string, unknown>
  const oldText = typeof e.oldText === 'string' ? e.oldText : ''
  const newText = typeof e.newText === 'string' ? e.newText : ''
  ...
}
```

The top-level args cast now uses the same guard, so `null`, `undefined`,
primitives, and arrays are treated as "no args":

```ts
const argsObj = isPlainEditObject(args) ? args : null
```

A non-array `edits` value was already handled safely by
`Array.isArray(argsObj.edits) ? argsObj.edits : []`; it is now covered by tests
so it cannot regress.

### Other Helpers Reviewed

- `extractToolSummary` already guarded its top-level args cast with
  `typeof args === 'object' && args !== null` and has a `try/catch`, so it
  needed no change. Its existing hostile-input tests (string, number, null,
  undefined, array, throwing proxies) continue to pass.
- `computeLineDiffStats`, `computeLCSLength`, and `computeSetBasedDiffStats`
  only receive strings after the caller's `typeof ... === 'string'` checks and
  contain no cast-then-read pattern on untrusted values.

No other unsafe cast-then-read-property patterns were found in
`tool-summary.ts`.

## Tests

In `src/tests/shared/tool-summary.test.ts`:

- Changed the `edits: [null]` test from `expect(...).toThrow()` to
  `expect(...).toBeNull()`. The original "REAL BUG" comment is preserved and a
  new comment explains the fix.
- Added mixed valid + null entries: only valid edits contribute to the stats
  (`{ added: 2, removed: 2 }`).
- Added `undefined`, number, string, and array entries: all skipped; with no
  valid edits the result is `null`.
- Added a single valid edit surrounded by invalid entries: the valid edit's
  stats are unchanged.
- Added non-array `edits` values (string, object, null): treated as no edits,
  no crash.
- Added an all-valid regression test asserting the same result as before the
  guard.
- Added `null`/`undefined` args tests for the guarded top-level cast.

## Behavior of Valid Input

Valid input is unchanged. A normal `edits` array of plain objects with
`oldText`/`newText` strings produces exactly the same `DiffStats` as before the
fix; the guard only drops entries that previously caused a crash (or had no
usable text). The `write` tool branch was not modified.
