# Node 26 globals shadow jsdom storage in renderer tests

## Symptoms

Running the standard `bun run test` command on Node 26 failed 53 renderer tests
in the command history, commands, and zoom suites. Their setup called
`localStorage.clear()`, but global localStorage was undefined instead of the
jsdom Storage object. Disabling Node Web Storage with an environment flag hid
the failure and made ordinary test runs depend on an external workaround.

## Cause and fix

Node 26 exposes Web Storage globals independently of jsdom. Vitest's browser
global installation can retain the existing Node global rather than replacing
it with window.localStorage. Shared test setup now explicitly binds global
localStorage and sessionStorage to the active jsdom window's storage objects.
The binding runs only in browser test environments; Node-only tests keep their
own globals. Application code and the normal test command remain unchanged.

## Verification

A renderer regression test checks object identity and storage access through
both globalThis and window. The existing command history, commands, and zoom
suites verify their real storage behavior. Both branches are validated with
plain `bun run test`, without NODE_OPTIONS or skipped failing tests.
