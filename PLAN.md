# Vitest Test Suite — Comprehensive Setup

## Context

The project (nekocode) is an Electron app using `electron-vite` with React renderer and Node.js main process. It already has vitest installed with 4 basic test files covering main-process modules (`project-manager`, `session-manager`, `stream-batcher`, `scaffold`). However:

- **No renderer tests** — React components, hooks, and stores are untested
- **No shared module tests** — `ipc-channels.ts` type constants, `ipc-types.ts` type contracts
- **No path alias resolution** — `@/*` alias from tsconfig is not configured in vitest
- **No jsdom environment** — Renderer tests can't run without it
- **No test utilities** — No setup file, no render helpers, no mock factories for renderer
- **No coverage tooling** — `@vitest/coverage-v8` not installed
- **`bun test` risk** — Running `bun test` (without `run`) triggers bun's internal test runner. The `package.json` "test" script already maps to `vitest run`, so `bun run test` works correctly. A note in `AGENTS.md` will warn against using `bun test` directly.

## Approach

1. **Document `bun test` warning** in `AGENTS.md` — `bun run test` already maps to `vitest run` via package.json scripts, but `bun test` (without `run`) triggers bun's internal runner
2. **Upgrade vitest.config.ts** — add `jsdom` workspace, path aliases, coverage config, global APIs
3. **Install missing test dependencies** — `@vitest/coverage-v8`, `jsdom` (for hook/store tests that need a DOM-like env)
4. **Create test infrastructure** — setup file for jsdom globals, mock factories
5. **Write tests** — grouped by testability tier:
   - **Tier 1 (pure functions)** — `tool-summary.ts`, `ipcToChatMessage`/`ipcToChatMessages`, `generateId`, `IPC_CHANNELS` constants
   - **Tier 2 (main process)** — Expand existing `stream-batcher`, `project-manager`, `session-manager` tests with edge cases
   - **Tier 3 (React hooks)** — `useSession` (unit-test the pure parts, integration with mocked window.nekoCode)
   - **Tier 4 (stores)** — `project-store` (provider + store actions/reducers)
   - **Tier 5 (scaffold)** — Expand existing scaffold test

## Files to Modify

| File | Action |
|------|--------|
| `AGENTS.md` | **Edit** — add warning about `bun test` vs `bun run test` |
| `vitest.config.ts` | **Rewrite** — workspace config with node + jsdom projects, path aliases, coverage |
| `package.json` | **Edit** — add deps, add `test:coverage` script |
| `src/tests/setup.ts` | **Create** — jsdom globals, `window.nekoCode` base mock |
| `src/tests/test-utils.tsx` | **Create** — mock factories, IPC shape helpers |
| `src/tests/shared/ipc-channels.test.ts` | **Create** |
| `src/tests/shared/ipc-types.test.ts` | **Create** — type contract validation |
| `src/tests/shared/tool-summary.test.ts` | **Create** |
| `src/tests/shared/chat-utils.test.ts` | **Create** — `ipcToChatMessage`, `ipcToChatMessages`, `generateId` |
| `src/tests/main/stream-batcher.test.ts` | **Edit** — add edge cases |
| `src/tests/main/session-manager.test.ts` | **Edit** — add edge cases |
| `src/tests/main/project-manager.test.ts` | **Edit** — add edge cases |
| `src/tests/renderer/useSession.test.ts` | **Create** |
| `src/tests/renderer/project-store.test.tsx` | **Create** |

## Reuse

| Existing Code | Location | Reuse For |
|---------------|----------|-----------|
| `StreamBatcher` class | `src/main/stream-batcher.ts` | Expanding existing tests |
| `ProjectManager` class | `src/main/project-manager.ts` | Expanding existing tests |
| `PiSessionManager` class | `src/main/session-manager.ts` | Expanding existing tests |
| `createMockSession()` helper | `src/tests/session-manager.test.ts` | Pattern for new mock factories |
| `makeSession()` helper | `src/tests/project-manager.test.ts` | Pattern for new mock factories |
| `extractToolSummary()` | `src/renderer/src/components/chat/tool-summary.ts` | Pure function tests |
| `ipcToChatMessage()` / `ipcToChatMessages()` | `src/renderer/src/hooks/useSession.ts` | Extract & test as pure functions |
| `generateId()` | `src/renderer/src/types/chat.ts` | Pure function test |
| `IPC_CHANNELS` const | `src/shared/ipc-channels.ts` | Constant validation test |
| `SessionStreamEvent` type | `src/shared/ipc-types.ts` | Type contract tests |
| `ChatMessageIPC` type | `src/shared/ipc-types.ts` | Type contract tests |
| `ProjectProvider` + `useProjectStore` | `src/renderer/src/stores/project-store.tsx` | Lightweight store unit tests via mocked context |

## Steps

- [ ] **Step 1: Add `bun test` warning to `AGENTS.md`** — Document that `bun run test` triggers vitest via package.json script, but `bun test` directly invokes bun's internal test runner and should not be used
- [ ] **Step 2: Install test dependencies** — `bun add -D @vitest/coverage-v8 jsdom`
- [ ] **Step 3: Rewrite `vitest.config.ts`** — Workspace with two projects (node for main/shared, jsdom for renderer), resolve `@/*` alias, configure coverage (v8 provider, `src/` include, `node_modules`/`src/tests`/`*.d.ts` exclude), global test APIs (`describe`/`it`/`expect`/`vi`), setup file
- [ ] **Step 4: Add `test:coverage` script** to `package.json`
- [ ] **Step 5: Create `src/tests/setup.ts`** — Set up jsdom-specific globals (e.g., `TextEncoder`/`TextDecoder` if needed), mock `window.nekoCode` base shape
- [ ] **Step 6: Create `src/tests/test-utils.tsx`** — `createMockIPC()` factory for `window.nekoCode` matching the `NekoCodeIPC` interface shape, helper to reset mocks between tests
- [ ] **Step 7: Write shared pure-function tests** — `tool-summary.test.ts` (all switch cases + edge cases), `chat-utils.test.ts` (`ipcToChatMessage` with text-only, tool-only, both, empty content; `ipcToChatMessages` flatMap; `generateId` uniqueness), `ipc-channels.test.ts` (no duplicates, correct format pattern, all keys present)
- [ ] **Step 8: Expand main process tests** — Add edge cases to `stream-batcher` (concurrent dispose + push, very long delta strings), `session-manager` (reconnect flow, dispose during active stream, multiple sessions), `project-manager` (duplicate project add, remove non-existent, empty session list)
- [ ] **Step 9: Write hook test** — `useSession.test.ts` (mock `window.nekoCode`, test event-to-message conversion via pure functions extracted from hook, draft save/restore, abort flow — tested via lightweight mock wrappers, no @testing-library/react)
- [ ] **Step 10: Write store test** — `project-store.test.tsx` (initial state, addProject, removeProject, setActiveSession — tested via lightweight mock wrappers)
- [ ] **Step 11: Run full suite** — `bun run test` and `bun run test:coverage` to verify everything passes

## Verification

1. `bun run test` — All tests pass (vitest, not bun's internal runner)
2. `bun run test:coverage` — Generates coverage report, >80% on pure functions
3. `bun run test -- --watch` — Watch mode works for development
4. No TypeScript errors in test files
5. Both node and jsdom environments resolve correctly (main tests use node, renderer tests use jsdom)
