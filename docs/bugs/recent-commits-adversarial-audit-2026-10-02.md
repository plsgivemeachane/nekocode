# Recent commit adversarial test audit — 2026-10-02

## Remediation status

The follow-up request to make all tests green is complete: **1,884 executable
cases pass, zero fail, and 25 pre-existing TODOs remain**, across 102 files in both
normal order and shuffled order with seed `20261002`. Two additional Git regression
cases bring the suite to 1,909 recorded cases, including TODOs. All 69 adversarial
cases pass. Lint, type-check, and local AppImage packaging also pass.

The remaining sections preserve the original failing audit as historical evidence.
The JSON inventory retains those original statuses and failure messages and adds
`afterFixNormal`/`afterFixShuffled` fields for every current testcase.

Fix details:

- [Git queue, stale queries, and diff cancellation](adversarial-git-operations-fixes.md)
- [Polling lifecycle and file-search generations](adversarial-polling-search-fixes.md)
- [Session completion, Auto commit identity, and malformed input](adversarial-session-auto-commit-and-input-fixes.md)
- [Existing randomized-test fixture repairs](adversarial-existing-test-isolation-fixes.md)

## Scope and outcome

The requested scope is **all eight commits from the last 10 days**, selected with
`git log --since='10 days ago'` at HEAD `69b3fd27c105b752b8a044c29dd45f000f608c18`.
This is a test-only change: 16 new Vitest files containing 67 executable cases.
Production source, existing tests, dependencies, and code comments are unchanged.

The original suite has **1,815 passing cases and 25 TODOs**, with no failures.
In the normal-order run with the added tests, **1,867 cases pass, 15 fail, and the same 25 remain TODO**
across 102 files. All original normal-order case statuses are preserved. The new cases account
for 52 passes and all 15 failures. There are no new skips, TODOs, or expected-failure
annotations. The failures deliberately remain ordinary failing assertions so that
fixes must satisfy the behavior being tested.

Thirteen failing cases exercise supported inputs, ordering, or state transitions.
Two explicitly named robustness-policy probes exercise a malformed SDK event and
a negative result limit. Their desired policies are proposals; neither proves that
a documented valid-input contract has regressed. Multiple cases can expose the
same underlying defect, so 15 failures should not be read as 15 independent bugs.

The [complete per-case result inventory](../testing/recent-commits-test-results-2026-10-02.json)
records every case in the full suite, including its name, status, and failure
message, normal/shuffled statuses, commit associations for the new files, and the baseline comparison.
Every new case was inspected for its oracle, fixture, mocked boundary, cleanup,
and observed result. Existing cases were executed and their individual statuses
compared with the baseline; this does not claim a static audit of every old assertion.

## Commit coverage

| Commit | Change | Added tests / review |
| --- | --- | --- |
| `69b3fd2` | Auto commit button and session creation | `GitCommandCenter.auto-commit.adversarial.test.tsx`: false title match, retry after rejection, repeated clicks while creation is pending. Existing orchestration tests also run in the full suite. |
| `48d9699` | Narrow-window layout | `NavBar.responsive.adversarial.test.tsx`: keyboard search activation and responsive structural classes. Real pixel geometry remains unverified. |
| `2dfc657` | Grouped provider/model selector | `ModelSelector.adversarial.test.tsx`: matching-name search across providers, colliding model IDs, current marker identity, stale search reset, disabled picker. |
| `0fc92db` | Documentation | Read the model-selector, responsive-layout, and Auto commit notes and use their stated behaviors as test oracles. No executable behavior is introduced by this commit. |
| `f3746fa` | Broad UI/runtime port | Actual Git/search/polling hooks and project provider; diff virtualizer interface and real patch application; IPC sender validation order; batching and retry settlement; search filesystem limits/exclusions. |
| `f580097` | Linux development launcher | `main/worker-launcher.recent-adversarial.test.ts`: sandbox-helper policy and argument preservation. Tests call the real argument helper. |
| `7e70766` | jsdom storage setup | `renderer/browser-storage.recent-adversarial.test.ts`: actual jsdom backing identity, local/session isolation, clear/remove/length/key behavior. |
| `49c656d` | Pi SDK 0.99.2 | Secure token storage transformation and per-provider decryption failure isolation; SDK asset validation; actual session manager retry settlement and text-before-done delivery. |

These associations identify the recent change being exercised, not necessarily
the introduction date of every defect. In particular, Git mutation locking,
status/diff response handling, and unconditional post-commit error clearing
predate these commits (`git blame` attributes the relevant logic to May 2026).
The recent polling port makes those existing paths worth testing again.

## Supported-input failures and recommended repairs

### Git operation queue releases multiple waiters

**Case:** Three stage requests arrive before the first finishes. The second IPC
mutation remains pending, but the third has already started. Two-request ordering
and recovery from a rejected predecessor pass; the three-request case fails.

**Cause:** [useGitOperations.ts](../../src/renderer/src/hooks/useGitOperations.ts#L207)
reads the current promise before awaiting it. Both waiters await the same first
promise, then start together without reserving separate positions in the queue.

**Recommendation:** Chain each request onto a per-operation tail before awaiting
it, preserving ordering after both success and rejection. Keep the lock held
through the mutation's refresh; the passing two-request test includes a pending
refresh to enforce that boundary.

### Stale Git status crosses project boundaries

**Case:** Project A's status request starts; the user selects B; B's status loads;
A then resolves. The displayed branch changes back to A.

**Cause:** [useGitOperations.ts](../../src/renderer/src/hooks/useGitOperations.ts#L232)
applies responses without validating that their project generation is still active.

**Recommendation:** Tie requests and state updates to the current project generation,
including error and loading updates. This is an existing bug surfaced by the new tests.

### Stale Git diff overwrites or resurrects a selection

**Cases:** A slow first-file diff replaces a newer second-file diff; separately,
a pending diff repopulates the panel after `clearDiff()` has cleared it.

**Cause:** [useGitOperations.ts](../../src/renderer/src/hooks/useGitOperations.ts#L473)
unconditionally applies completed diff requests, and clearing the panel does not
invalidate pending requests.

**Recommendation:** Use a request generation for diff selection; increment it on
new selection, clear, and project switch. Apply both patch and summary only for
the latest generation.

### Successful commit erases a failed refresh

**Case:** The commit succeeds but its following status refresh rejects. The public
error becomes `null`, hiding the failure while the UI can show stale Git state.

**Cause:** [useGitOperations.ts](../../src/renderer/src/hooks/useGitOperations.ts#L369)
clears the error after `Promise.allSettled`, regardless of refresh outcomes.

**Recommendation:** Preserve refresh failures while retaining the successful commit
result. A successful mutation does not prove that subsequent queries succeeded.

### Polling error count does not reflect resets

**Cases:** A successful manual refresh following a failed tick leaves the reported
`errorCount` at 1. Calling `resetBackoff()` also leaves it at 1.

**Cause:** [usePolling.ts](../../src/renderer/src/hooks/usePolling.ts#L139) resets
the refs but does not update the corresponding React state in those paths.

**Recommendation:** Update the observable count whenever the underlying count resets.
These two cases exercise different entry points into the same consistency problem.

### Initially hidden windows poll anyway

**Case:** Mount with `document.hidden === true` and advance three ticks. The poll
callback runs three times even though `pauseWhenHidden` is enabled.

**Cause:** [usePolling.ts](../../src/renderer/src/hooks/usePolling.ts#L120) initializes
visibility to `true` and waits for a later visibility-change event to correct it.

**Recommendation:** Initialize visibility from the document's current state.

### Old poll completion enters a re-enabled lifecycle

**Case:** A poll starts, polling is disabled, then it is re-enabled with a new
callback. Resolving the old poll invokes the current success callback before any
new poll has run.

**Cause:** [usePolling.ts](../../src/renderer/src/hooks/usePolling.ts#L180) uses a
shared stopped flag that becomes false again, allowing the old lifecycle through.

**Recommendation:** Capture a lifecycle generation and validate it after awaits,
including before callbacks and rescheduling. The separate no-overlap/unmount case passes.

### File search applies superseded results

**Cases:** An old query resolves after the new query and overwrites its results.
A request also repopulates results after the active project is removed.

**Cause:** [useSearchFiles.ts](../../src/renderer/src/hooks/useSearchFiles.ts#L63)
checks one shared abort flag that is reset by the next effect, reviving older requests.

**Recommendation:** Use request/project generations or request-local cancellation.
Guard results, errors, and loading state together.

### Same-turn selection marks the active session unread

**Case:** `setActiveSession('next', ...)` and the next session's `done` event occur
within one batched event turn. The active session is marked `finished_unread`.

**Cause:** [project-store.tsx](../../src/renderer/src/stores/project-store.tsx#L444)
uses a ref synchronized by an effect, which has not yet observed the queued selection.

**Recommendation:** Classify completion against the reducer's current active session
when it processes the event. This is a deterministic batching-boundary case; the
tests do not claim a measured frequency in real Electron IPC scheduling.

### Unrelated title blocks Auto commit

**Case:** A streaming session titled `Auto commitment notes` disables Auto commit
even though it is an ordinary manually started session.

**Cause:** [GitCommandCenter.tsx](../../src/renderer/src/components/git/GitCommandCenter.tsx#L46)
uses `startsWith('Auto commit')` as the session-kind discriminator.

**Recommendation:** Identify Auto commit sessions explicitly, or use the exact
generated prompt identity. A free-form user title should not establish operation ownership.

## Malformed-input robustness policies

- **Missing thinking delta:** The deliberately malformed event bypasses the SDK's
  TypeScript contract. Its `delta` is emitted as `undefined` and accumulation becomes
  the string `"undefined"`. The proposed policy is empty-string normalization, matching
  the existing text-delta guard. Rejecting malformed events is another valid policy;
  adopting it would require changing this proposed oracle. See
  [agent-event-processor.ts](../../src/main/agent-event-processor.ts#L215).
- **Negative result limit:** With two matching files, `limit: -1` returns one because
  `slice(0, -1)` drops the last entry. The proposed policy is clamping to zero. Explicit
  input rejection is an alternative. Normal `limit: 0` and `limit: 1` behavior passes.
  See [search-files.ts](../../src/main/search-files.ts#L173).

## Verification and limits

### Existing tests fail when their order changes

The following 17 cases fail in both the full shuffled run and the shuffled run
excluding all added files. They pass in normal order. The JSON inventory lists
each affected testcase and its shuffled failure message.

| Existing file | Failing cases | Observed isolation/oracle problem and recommended repair |
| --- | --- | --- |
| `renderer/useSessionEvents.test.ts` | 10 | The stress-test describe's setup does not install `window.nekocode`; it relies on the sibling describe having run first. Production access throws `window is not defined`. Share IPC setup across both describe blocks (`beforeEach` near lines 87 and 328). |
| `renderer/useAutoScroll.test.ts` | 1 | The module-level animation-frame spy retains earlier calls; the null-ref case asserts an empty history. Clear the spy before every test. |
| `renderer/useSession.hook.test.tsx` | 1 | `vi.clearAllMocks()` retains the prompt mock's rejected implementation. Restore a resolved default before every test. |
| `renderer/AssistantMessage.test.tsx` | 1 | The Markdown renderer spy retains calls from non-streaming cases; the streaming case incorrectly observes them. Reset its history before every test. |
| `renderer/MessagesTimeline.test.tsx` | 2 | The imperative-handle test overrides `MockVirtuoso` near line 149 with a renderer that omits `data-follow-output`. Setup near line 83 only clears calls, so later follow-output cases inherit that implementation. Restore the standard mock renderer before each test. |
| `renderer/MarkdownContent.test.tsx` | 1 | The Shiki mock returns a Promise from `codeToHtml`, while production consumes its return value synchronously. The language-code case exposes this contract mismatch under changed order. Use a synchronous string result and handle asynchronous highlighter setup explicitly. |
| `message-store.test.ts` | 1 | The empty assistant-ID case does not initialize disk entries or the SDK list mock. It also assumes an empty string must block disk refresh, whereas production treats it as falsy. Initialize the fixture and decide that boundary's expected semantics explicitly. |

These are reported as test reliability/oracle findings, not 17 newly established
product defects. Existing cases remain unchanged in this test-addition task.

### Checks and remaining coverage gaps

- Full suite and each new case were run. A seeded shuffled run checks order dependence.
  The original suite's per-case statuses are compared in the JSON inventory.
- Full shuffling with seed `20261002` produces **1,850 passes, 32 failures, and 25 TODOs**.
  The 15 new failures are unchanged. The additional 17 failures also reproduce with
  all added files excluded: **1,798 passes, 17 failures, 25 TODOs**. This establishes
  pre-existing test order dependence rather than pollution by the new files.
- `bun run lint` and `bun run type-check` pass.
- `bun run package:local` passes and produces `dist/Nekocode-0.2.67.AppImage`.
  This establishes packaging compatibility; it does not establish that all behavioral
  tests pass. Packaging completed before the final fixture-only strengthening.
- The 25 existing TODO cases remain unimplemented and are recorded as TODO, never passes.
- NavBar tests verify responsive classes and keyboard activation in jsdom. They cannot
  prove overflow, viewport geometry, or actual Electron window resizing.
- SessionDiffView tests substitute the virtualizer and Shadow DOM renderer at their
  boundaries. They exercise scroll requests, lazy patch construction, item identity,
  and real patch application, not actual scrolling FPS or browser virtualization.
- SDK and Electron APIs are mocked where required. Secure-storage tests verify format
  transformation and credential isolation, not operating-system encryption strength.
  Dev launcher tests cover the real argument helper, not child-process signals/exit forwarding.
- The broad `f3746fa` port is covered by risk-focused new cases and the existing suite;
  this audit does not establish exhaustive branch coverage of every changed module.

Reproduce the added cases with `bun run test adversarial` and the normal full suite
with `bun run test`. Both commands currently exit nonzero because the 15 newly
exposed assertions fail. Reproduce all 32 shuffled failures with
`bun run test --sequence.shuffle --sequence.seed=20261002`. Isolate the 17 old
order-dependent failures with
`bun run test --exclude '**/*adversarial.test.*' --sequence.shuffle --sequence.seed=20261002`.
No production repair or commit was part of the initial test-creation task.
The subsequent user request authorized the repairs documented above; no commit
was created. The reproduction commands now pass, apart from the same visible
TODO cases that already existed before this audit.
