# Git operations adversarial failures

## Symptoms

The recent commit adversarial tests exposed five races in `useGitOperations`:

1. The operation lock allowed multiple waiters to observe the same completed
   tail and start together. Three stage requests could therefore overlap.
2. A status request for project A could update the state after the active
   project had changed to project B. Its error and loading cleanup had the same
   problem.
3. Repository probes from an old project could overwrite the repository flag
   for the new project, and the probe effect could be retriggered by its own
   state update.
4. Out-of-order diff responses, including a response that completed after
   `clearDiff`, could restore an obsolete selection and summary.
5. A successful commit unconditionally cleared the error after its refreshes,
   hiding a status refresh failure reported by the refresh itself.

## Fix

`useGitOperations` now chains each operation-lock tail at registration time,
which gives stage and other keyed mutations strict FIFO behavior. A project
generation and path check guards asynchronous repository, status, and diff
responses, errors, and loading cleanup. Diff requests also have a monotonic
request id that `clearDiff` invalidates. The repository probe ignores stale
projects. Commit no longer clears an error after its refreshes, so a failed
post-commit status refresh remains visible.

The same project-generation check covers log, branch, and stash responses. Clearing
a diff or switching projects also clears its loading indicator, because invalidated
requests intentionally cannot perform their old loading cleanup. The operation
queue returns each caller's own `Promise<T>` while its stored tail always settles,
so errors propagate to their caller without blocking the next queued request.

Final review caught a related cancellation regression: stale status/log/branch
requests no longer run their loading cleanup, so switching to a non-Git project
could leave those indicators permanently active. The project-reset branch now
clears all three loading flags. A regression starts all three old queries, switches
to a non-Git project, and verifies empty data and released loading state both before
and after the old queries settle.

## Verification

The focused adversarial and critical hook suites pass:

```text
The Git adversarial suite has 10 executable regression cases; the original critical
suite remains covered by the full run, including its 4 existing TODOs.
```

The hook lint check also passes. Final whole-suite checks pass in normal and
seeded shuffled order: 1,884 executable cases, zero failures, 25 existing TODOs.
