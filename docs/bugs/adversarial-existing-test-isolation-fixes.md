# Existing test isolation failures under randomized ordering

## Reproduction and impact

The normal baseline passed 1,815 executable cases with 25 TODOs. Randomizing the
suite using `--sequence.shuffle --sequence.seed=20261002` exposed 17 failures in
seven existing test files. All 17 reproduced with the new adversarial files
excluded, establishing that they were pre-existing test-fixture/oracle problems.

## Causes and repairs

- **Session event stress tests:** A sibling describe installed `window.nekocode`,
  while the stress describe assumed those globals already existed. Shared file
  setup now installs a fresh IPC callback and unsubscribe mock for every case.
  Teardown runs remaining hook cleanups and restores stubbed globals. The original
  per-case event assertions remain intact.
- **Auto-scroll:** The module-level animation-frame spy retained earlier calls.
  Both normal and stress setup now clear its history; teardown restores globals.
  The null-ref case can reliably assert that its own operation schedules no frame.
- **Session prompt/abort:** `vi.clearAllMocks` clears calls, not implementations.
  Prompt and abort rejection tests therefore contaminated later successful cases.
  Setup now resets prompt, abort, and history mocks to explicit resolved defaults.
- **Assistant rendering:** The shared Markdown renderer spy retained calls from
  earlier non-streaming cases. A per-case call reset makes the streaming assertion
  observe only its own renderer activity.
- **Timeline renderer:** An imperative-handle case replaced the virtualizer mock
  with an implementation lacking `data-follow-output`. Later cases inherited that
  implementation despite cleared call history. Setup now restores the standard
  renderer function as well as clearing calls. The alternate renderer remains
  available for its original case; follow-output assertions are unchanged.
- **Markdown highlighting:** The Shiki mock returned a Promise from `codeToHtml`,
  while the component consumes that API synchronously. The mock now returns HTML
  synchronously; asynchronous highlighter acquisition remains asynchronous.
- **Disk message history:** The empty-assistant-ID stress case relied on earlier
  SDK list and disk-entry fixtures. Its describe now starts with an explicit empty
  disk and no matching session, preserving the expected null result without
  treating an empty string as an undocumented active-stream sentinel.

Fixing initially hidden polling also made a previously leaked `document.hidden`
fixture observable: the critical polling suite left the document hidden for later
cases. Its setup now establishes visibility per case and restores the previous
descriptor in teardown. This repairs isolation rather than changing the assertion
that an initially hidden polling hook must pause.

## Validation and scope

The targeted root shuffle run passes all 257 cases in its 12 files; the polling
lane also passes its original, critical, and adversarial cases. Whole-suite results
are recorded in the [audit](recent-commits-adversarial-audit-2026-10-02.md).

No assertions were removed to hide the original failures. No failing case was
skipped, marked as an expected failure, or converted to a TODO. The 25 TODOs that
already existed in the baseline remain visible; they describe unimplemented tests
and design proposals, not executable failures repaired by this work.
