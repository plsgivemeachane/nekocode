# opencodeui: Pi 0.99.2 event and validation compatibility

The destination branch routes both main and worker events through a shared
`AgentEventProcessor`. Applying the main-branch upgrade therefore requires
porting retry settlement handling to that processor rather than restoring the
old duplicated event handlers. The shared managed-session state tracks pending
retry completion, suppresses premature `done`, and emits exactly one deferred
completion when a cancelled retry settles. Model APIs use the SDK ModelRuntime
while the existing UI, IPC, and backend abstractions remain intact.

Regression tests cover pending retries, repeated settlement, and async model
lookup/listing. Full tests also exposed a stale scaffold assertion: this branch
launches development through `scripts/start-dev.cjs`, which invokes electron-vite
in dev mode and supplies Linux development flags. The assertion now checks this
actual launcher instead of requiring the old inline `electron-vite dev` command.
The development command itself remains unchanged.

The offline bundled-worker smoke covers extensions, session create/reconnect,
streaming, model selection, and UI requests. Full Windows installer validation
on Linux still requires Wine; unsigned unpacked packaging validates dependency
traversal and the bundled application without validating installers.
