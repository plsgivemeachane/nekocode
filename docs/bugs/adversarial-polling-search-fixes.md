# Adversarial polling and file-search fixes

## Symptoms

The recent adversarial tests found four observable polling failures and one
related class of file-search failures:

- `errorCount` changed internally when `resetBackoff` ran, but consumers did
  not receive the reset value until a later poll render.
- A hook mounted while `document.hidden` was already true still considered
  the window visible and performed its first poll.
- A poll promise from an old enabled/disabled cycle could call `onSuccess`,
  `onError`, update backoff state, or schedule another timer after polling had
  been re-enabled.
- Search responses and errors were accepted based on a shared abort boolean.
  A newer request could reset that boolean before an older IPC request
  completed, allowing stale results, errors, and loading state to overwrite
  the active query or project.

## Fix

`usePolling` now maintains a generation number for each effect lifecycle.
Timers and every asynchronous completion capture their generation and verify
that it is still current before invoking callbacks, changing backoff state, or
scheduling another tick. The hook initializes visibility from
`document.hidden`, and `resetBackoff` updates the reactive `errorCount` state
immediately. An in-flight poll remains marked as active across a temporary
disable, preserving the no-overlap guard until its promise settles.

`useSearchFiles` now uses a monotonically increasing request generation. Query
and project changes invalidate the previous generation immediately, and result,
error, and loading updates are applied only by the latest request. Removing a
project also clears results and errors synchronously while invalidating any
pending IPC response.

## Verification

The focused adversarial and original hook suites pass:

```text
Test Files  4 passed (4)
Tests       24 passed (24)
```

The final focused pass also includes the critical polling suite: 5 files,
41 executable cases, and 1 existing TODO. Timeout ownership is cleared as soon
as a timeout fires, so resetting backoff during a tick cannot create a duplicate
timer. The critical suite now resets/restores `document.hidden` independently for
each case instead of leaking hidden state into later polling mounts.

Type checking and ESLint also pass for the changed hooks. Final whole-suite checks
pass in normal and seeded shuffled order: 1,884 executable cases, zero failures,
25 existing TODOs.
