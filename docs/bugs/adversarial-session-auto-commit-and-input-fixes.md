# Session completion, Auto commit identity, and input-boundary fixes

## Active sessions could incorrectly become unread

When session selection and a completion event occur in the same React batch,
`ProjectProvider`'s effect-synchronized active-session ref still points to the
previous selection. The event handler previously assigned `finished_unread` using
that ref, even when the reducer was about to select the completed session.

The event handler now dispatches a `SESSION_DONE` action with the session ID.
The reducer chooses `idle` or `finished_unread` using its current active-session
state, after earlier queued selection actions. Completion still clears old errors;
background sessions retain the unread indicator until selected. The obsolete ref
and synchronization effect were removed, with their original comments retained
and annotated as historical implementation notes.

Regression coverage uses the actual provider, not a copied reducer:
`src/tests/renderer/project-store.recent-adversarial.test.tsx`. The same-turn case,
foreground/background behavior, selective unread clearing, and preservation of
streaming/error states all pass.

## Ordinary session titles could block Auto commit

`GitCommandCenter` used `firstMessage.startsWith('Auto commit')` to classify
running Auto commit sessions and persistent prompt errors. A manually created
session titled `Auto commitment notes` therefore disabled the button.

The panel now compares the complete first line with the opening line of
`AUTO_COMMIT_PROMPT`. Actual generated messages contain that line even when the
first message is truncated to 100 characters. Sharing a few opening words no
longer assigns the session Auto commit behavior. Both the running-session and
persisted-error paths use the same comparison.

Existing tests used abbreviated, invented titles such as `Auto commit`; their
fixtures now use the actual generated prompt truncated to the same 100-character
boundary as session creation. Assertions for disabled running sessions and visible
errors are retained. The unrelated-title regression, repeated-click guard, and
creation-error retry tests remain unchanged and pass. This identifies generated
prompt text, not durable session-kind metadata; a manually entered identical
opening line is still indistinguishable at this boundary.

## Missing thinking deltas could corrupt content

The SDK normally supplies a string `delta`, but a malformed thinking event could
emit `undefined` and append the literal string `"undefined"` to accumulated
thinking content. Text deltas already had an empty-string guard.

`AgentEventProcessor` now normalizes a missing/null thinking delta to `''`, matching
the text-delta boundary. The malformed-event regression verifies both emitted
data and accumulated content. Retry settlement behavior remains covered.

## Negative search limits could return arbitrary partial results

`searchFiles` passed its result limit directly to `Array.slice`. With two files,
`limit: -1` returned one file rather than zero because a negative end index counts
backwards from the array end.

The result count is now a nonnegative integer. Finite values are truncated and
clamped at zero; nonfinite values use the existing default limit of 50. A zero
limit returns before filesystem traversal. Both empty-query and fuzzy-query paths
use the normalized value. The negative-limit regression and supported zero/one
boundaries pass. These policies deliberately resolve the two proposed robustness
expectations from the initial audit.

## Validation

The focused root integration run passed 257 cases across 12 files, including the
actual project provider, Auto commit, processor, search, and repaired test fixtures,
under shuffle seed `20261002`. Final whole-suite, lint, type-check, and packaging
results are recorded in the linked [audit](recent-commits-adversarial-audit-2026-10-02.md)
and [per-case inventory](../testing/recent-commits-test-results-2026-10-02.json).
