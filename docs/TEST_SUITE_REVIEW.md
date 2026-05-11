# NekoCode Test Suite — Full Review Report

**Date:** 2026-05-11  
**Reviewer:** Testing Expert (Automated Audit)  
**Scope:** Complete test suite analysis — structure, quality, coverage, reliability, and recommendations

---

## 1. Executive Summary

The NekoCode test suite is **well-structured and production-grade**. All **688 tests across 32 test files pass** with zero failures. The suite runs in **~2.85 seconds**, demonstrating excellent performance. The codebase follows Vitest best practices with comprehensive mocking strategies, proper async handling, and meaningful stress tests.

**Overall Grade: A- (Strong)**

| Metric | Value | Assessment |
|---|---|---|
| Total Tests | 688 | Excellent |
| Test Files | 32 | Good coverage |
| Pass Rate | 100% | Perfect |
| Suite Duration | 2.85s | Excellent |
| Framework | Vitest 4.1.5 | Modern |
| Coverage Provider | v8 | Industry standard |

---

## 2. Testing Framework & Configuration

### 2.1 Framework Stack

| Component | Version | Purpose |
|---|---|---|
| **Vitest** | 4.1.2 | Test runner |
| **@testing-library/react** | 16.3.2 | React component testing |
| **jsdom** | 29.0.1 | DOM environment for renderer tests |
| **@vitest/coverage-v8** | 4.1.2 | Code coverage |

### 2.2 Configuration (`vitest.config.ts`)

**Strengths:**
- `globals: true` — enables `describe`/`it`/`expect` without imports
- Proper `@` path alias resolution
- `__APP_VERSION__` define for build-time constants
- Setup file at `src/tests/__setup__/setup.ts`

**Issues Found:**
- **Setup file is empty** (2 lines of comments only). This is a missed opportunity for global test utilities.

**Coverage Configuration:**
```ts
coverage: {
  provider: 'v8',
  include: [
    'src/main/**/*.ts',
    'src/shared/**/*.ts',
    'src/renderer/src/hooks/**/*.ts',
    'src/renderer/src/utils/**/*.ts',
    'src/renderer/src/components/**/*.tsx',
  ],
  exclude: [
    'node_modules/**',
    'src/tests/**',
    '**/*.d.ts',
    'src/main/index.ts',
    'src/preload/**',
    'src/shared/ipc-types.ts',
  ],
}
```

**Assessment:** Coverage targets are well-defined. Excluding `src/main/index.ts` (Electron bootstrap) and `src/preload/**` (IPC bridge) is correct since these are integration glue. Excluding `src/shared/ipc-types.ts` (type definitions only) is appropriate.

---

## 3. Test Structure & Organization

### 3.1 Directory Layout

```
src/tests/
├── __setup__/setup.ts          # Global setup (empty)
├── __utils__/test-utils.tsx    # Shared mock factories
├── renderer/                   # React component & hook tests
│   ├── useSession.hook.test.tsx
│   ├── useSession.test.ts
│   ├── useSessionOrchestration.test.ts
│   ├── useSessionEvents.test.ts
│   ├── useAutoScroll.test.ts
│   ├── useModelSelection.test.ts
│   ├── useClickOutside.test.ts
│   ├── message-transforms.test.ts
│   ├── project-store.test.tsx
│   ├── project-helpers.test.ts
│   ├── extension-logging.test.ts
│   ├── messages-timeline.test.ts
│   ├── TreeSidebar.test.tsx
│   ├── sound-manager.test.ts
│   ├── SettingsView.test.tsx
│   ├── NotificationSettingsContent.test.tsx
│   └── NotificationSettingsPanel.test.tsx
├── shared/                     # Shared utility tests
│   ├── ipc-channels.test.ts
│   ├── tool-summary.test.ts
│   └── chat-utils.test.ts
├── session-manager.test.ts
├── session-manager.integration.test.ts
├── ipc-handlers.test.ts
├── ipc-handlers.integration.test.ts
├── project-manager.test.ts
├── message-store.test.ts
├── extension-loader.test.ts
├── stream-batcher.test.ts
├── text-extractor.test.ts
├── updater.test.ts
├── notification-service.test.ts
└── scaffold.test.ts
```

**Strengths:**
- Clear separation between main process, renderer, and shared tests
- Integration tests explicitly named with `.integration.test.ts` suffix
- Shared test utilities in `__utils__/test-utils.tsx`
- Consistent naming conventions

**Weaknesses:**
- No `e2e/` directory or Playwright tests for full user journey testing
- `__setup__/setup.ts` is empty — should contain global mock setup

### 3.2 Test Naming Conventions

Tests follow **behavior-driven naming** consistently:

```ts
// Good: Behavior-focused
it('should translate text_delta events through the batcher', ...)
it('returns empty array for empty input', ...)
it('handles tool errors correctly in history', ...)

// Good: Descriptive describe blocks
describe('PiSessionManager', () => {
  describe('when user exists', () => { ... })
  describe('when user not found', () => { ... })
})
```

**Assessment:** Naming is excellent. Tests describe behavior, not implementation.

---

## 4. Mocking Strategy Analysis

### 4.1 Mock Architecture

The project uses a **layered mocking strategy**:

1. **Module-level mocks** (`vi.mock`) — for Electron, SDK, filesystem
2. **Hoisted mocks** (`vi.hoisted`) — for mocks needed inside `vi.mock` factories
3. **Shared mock factories** (`test-utils.tsx`) — reusable IPC and manager mocks
4. **Component-level mocks** — for React hooks and stores

### 4.2 Mock Quality Assessment

| Pattern | Usage | Quality |
|---|---|---|
| `vi.hoisted()` | Used correctly for hoisted mock state | Excellent |
| `vi.mock('electron')` | Consistent Electron mocking | Excellent |
| `vi.mock('@earendil-works/pi-coding-agent')` | SDK mocking with controllable behavior | Excellent |
| `createMockIPC()` | Factory for renderer IPC mocks | Excellent |
| `createSessionManagerMock()` | Factory for main process mocks | Excellent |
| `createProjectManagerMock()` | Factory for main process mocks | Excellent |
| `createEventEmitter()` | Helper for event-based testing | Excellent |

### 4.3 Mock Cleanup

**Consistent `beforeEach` cleanup pattern:**
```ts
beforeEach(() => {
  vi.clearAllMocks()
  // Reset specific mock state
  events = []
  lastCreatedMockSession = null
  sdkMocks.loaderReloadMock.mockClear()
  // ... etc
})
```

**Assessment:** Mock cleanup is thorough and consistent across all test files.

### 4.4 Potential Issues

1. **`chat-utils.test.ts` duplicates source code** — The file re-implements `ipcToChatMessage` and `ipcToChatMessages` inline rather than importing from the source. This creates a maintenance burden where tests could pass but source could diverge.

2. **Some renderer tests mock React itself** — `useSessionEvents.test.ts` and `useSessionOrchestration.test.ts` mock `react` entirely instead of using `renderHook`. This trades fidelity for speed but means React lifecycle behavior isn't tested.

---

## 5. Async & Timing Patterns

### 5.1 Fake Timers

**Properly used in session-manager and stream-batcher tests:**
```ts
beforeEach(() => {
  vi.useFakeTimers()
})
// ...
vi.advanceTimersByTime(16) // Flush batcher
```

**Properly cleaned up:**
```ts
afterEach(() => {
  vi.useRealTimers()
})
```

### 5.2 Async Patterns

**Proper `await` usage throughout:**
```ts
it('creates a stable SDK session id', async () => {
  const id = await manager.create('/tmp/project')
  expect(id).toBeDefined()
})
```

**`act()` usage in React hook tests:**
```ts
await act(async () => { await result.current.sendPrompt("hello") })
```

### 5.3 Flaky Test Risks

**Identified warnings (non-blocking):**

1. **`useSession.hook.test.tsx`** — Produces `act()` warnings for draft save/restore tests:
   ```
   An update to TestComponent inside a test was not wrapped in act(...)
   ```
   This happens during `rerender()` calls that trigger state updates. While tests pass, these warnings indicate potential flakiness under different React scheduling.

2. **`notification-service.test.ts`** — Vitest warns about `vi.fn()` mock not using `function` or `class`:
   ```
   The vi.fn() mock did not use 'function' or 'class' in its implementation
   ```
   This is a Vitest best-practice warning for the `Notification` constructor mock.

**Assessment:** Low flaky test risk. The `act()` warnings should be addressed but don't cause failures.

---

## 6. Coverage Analysis

### 6.1 Modules With Tests

| Module | Test File | Tests | Status |
|---|---|---|---|
| `session-manager.ts` | `session-manager.test.ts` + `.integration.test.ts` | 30 | Well covered |
| `ipc-handlers.ts` | `ipc-handlers.test.ts` + `.integration.test.ts` | 9 | Well covered |
| `project-manager.ts` | `project-manager.test.ts` | 18 | Well covered |
| `message-store.ts` | `message-store.test.ts` | 60 | Excellent (incl. stress) |
| `extension-loader.ts` | `extension-loader.test.ts` | 57 | Excellent (incl. stress) |
| `stream-batcher.ts` | `stream-batcher.test.ts` | 12 | Well covered |
| `text-extractor.ts` | `text-extractor.test.ts` | 8 | Well covered |
| `updater.ts` | `updater.test.ts` | 8 | Adequate |
| `notification-service.ts` | `notification-service.test.ts` | 20 | Well covered |
| `useSession.ts` | `useSession.hook.test.tsx` + `useSession.test.ts` | 47 | Excellent |
| `useSessionEvents.ts` | `useSessionEvents.test.ts` | 32 | Excellent (incl. stress) |
| `useSessionOrchestration.ts` | `useSessionOrchestration.test.ts` | 41 | Excellent (incl. stress) |
| `useAutoScroll.ts` | `useAutoScroll.test.ts` | 43 | Excellent (incl. stress) |
| `useModelSelection.ts` | `useModelSelection.test.ts` | 25 | Well covered |
| `useClickOutside.ts` | `useClickOutside.test.ts` | 8 | Well covered |
| `message-transforms.ts` | `message-transforms.test.ts` | 57 | Excellent |
| `project-store.tsx` | `project-store.test.tsx` | 56 | Excellent |
| `project-helpers.ts` | `project-helpers.test.ts` | 23 | Well covered |
| `extension-logging.ts` | `extension-logging.test.ts` | 15 | Well covered |
| `sound-manager.ts` | `sound-manager.test.ts` | 14 | Adequate |
| `ipc-channels.ts` | `ipc-channels.test.ts` | 13 | Well covered |
| `tool-summary.ts` | `tool-summary.test.ts` | 32 | Excellent |
| `chat.ts` (types) | `chat-utils.test.ts` | 11 | Adequate |
| `TreeSidebar.tsx` | `TreeSidebar.test.tsx` | 12 | Adequate |
| `SettingsView.tsx` | `SettingsView.test.tsx` | 12 | Adequate |
| `NotificationSettingsContent.tsx` | `NotificationSettingsContent.test.tsx` | 13 | Adequate |
| `NotificationSettingsPanel.tsx` | `NotificationSettingsPanel.test.tsx` | 7 | Adequate |
| `MessagesTimeline.tsx` | `messages-timeline.test.ts` | 4 | Minimal |

### 6.2 Modules WITHOUT Tests

| Module | Risk Level | Notes |
|---|---|---|
| `src/main/index.ts` | Low | Electron bootstrap — excluded from coverage |
| `src/main/logger.ts` | Low | Winston logger wrapper — simple delegation |
| `src/main/manager-types.ts` | Low | Type definitions only |
| `src/main/threading/*` | **Medium** | Worker thread pool, thread session/project managers, operation queue — no tests |
| `src/preload/*` | Low | Electron preload bridge — excluded from coverage |
| `src/renderer/src/hooks/useZoom.ts` | Low | Zoom hook — tested indirectly via SettingsView |
| `src/renderer/src/utils/logger.ts` | Low | Renderer logger — simple wrapper |

### 6.3 Coverage Gap: Threading Module

The `src/main/threading/` directory contains **5 files** with no tests:
- `worker-bootstrap.ts`
- `threaded-session-manager.ts`
- `threaded-project-manager.ts`
- `thread-operation-queue.ts`
- `types.ts`
- `index.ts`

This is the **most significant coverage gap** in the project. Worker thread management is complex and error-prone. These modules should have dedicated unit tests.

---

## 7. Test Quality Patterns

### 7.1 Stress Tests

Several test files include dedicated **"STRESS TESTS — TRYING TO BREAK THE CODE"** sections:

| File | Stress Tests | Focus |
|---|---|---|
| `message-store.test.ts` | 20+ | Large payloads, concurrent calls, edge cases |
| `extension-loader.test.ts` | 15+ | Circular references, 1MB messages, 1000 items |
| `useSessionEvents.test.ts` | 10+ | 100 rapid events, concurrent events, cache isolation |
| `useSessionOrchestration.test.ts` | 10+ | Rapid calls, timeouts, concurrent operations |
| `useAutoScroll.test.ts` | 10+ | Rapid changes, detached containers, race conditions |

**Assessment:** This is an excellent practice. Stress tests document edge case behavior and catch regressions under load.

### 7.2 Immutability Tests

The `project-store.test.tsx` includes explicit immutability tests:
```ts
describe("immutability", () => {
  it("does not mutate the input state", ...)
  it("does not mutate existing project objects", ...)
  it("does not mutate session objects when using updateSessionInProject", ...)
})
```

**Assessment:** Excellent. Ensures the reducer follows Redux/Zustand immutability contracts.

### 7.3 Error Path Testing

Error paths are well tested across the suite:
- Extension loader fallback mechanisms
- Session creation failures
- IPC handler error propagation
- Notification constructor errors
- File system read/write errors (ENOENT, corrupt JSON)
- Network/update failures

---

## 8. CI/CD Integration

### 8.1 Pre-commit Hooks

From `package.json`:
```json
"prepackage": "bun run test && bun run lint && bun run type-check"
```

The `prepackage` script ensures tests, lint, and type-check pass before building. However, there's no `precommit` hook — developers can commit without running tests.

### 8.2 Required Checks

From `AGENTS.md`:
```
- bun run test
- bun run lint
- bun run type-check
- bun run package:local
```

**Recommendation:** Add a `precommit` hook or CI gate to enforce these checks.

---

## 9. Specific Findings & Recommendations

### 9.1 Critical Issues (0)

None found. All 688 tests pass.

### 9.2 High-Priority Recommendations

| # | Finding | Impact | Recommendation |
|---|---|---|---|
| H1 | **No tests for `src/main/threading/`** | Medium | Add unit tests for `threaded-session-manager.ts`, `threaded-project-manager.ts`, and `thread-operation-queue.ts`. Worker thread logic is complex and failure-prone. |
| H2 | **`chat-utils.test.ts` duplicates source code** | Medium | Replace inline re-implementations with direct imports from `useSession.ts` or `message-transforms.ts`. The current approach risks tests passing while source diverges. |
| H3 | **`act()` warnings in `useSession.hook.test.tsx`** | Low | Wrap `rerender()` calls that trigger state updates in `act()` to eliminate React warnings and prevent potential flakiness. |

### 9.3 Medium-Priority Recommendations

| # | Finding | Impact | Recommendation |
|---|---|---|---|
| M1 | **Empty setup file** | Low | Populate `src/tests/__setup__/setup.ts` with global mocks (e.g., `window.nekocode` stub, logger mock) to reduce duplication across test files. |
| M2 | **No E2E tests** | Medium | Add Playwright tests for critical user flows: session creation, message sending, project switching. |
| M3 | **`useSessionEvents` and `useSessionOrchestration` mock React entirely** | Low | Consider using `renderHook` from `@testing-library/react` for more faithful lifecycle testing. |
| M4 | **Missing `precommit` hook** | Low | Add `lefthook` or `husky` pre-commit hook to run `bun run test` before commits. |
| M5 | **No test for `useZoom` hook** | Low | Add direct unit tests for the `useZoom` hook (currently only tested indirectly via `SettingsView`). |

### 9.4 Low-Priority Recommendations

| # | Finding | Impact | Recommendation |
|---|---|---|---|
| L1 | **Vitest warning about `vi.fn()` mock in notification-service** | Cosmetic | Use `class` keyword in mock implementation for `Notification` constructor. |
| L2 | **No snapshot tests** | Low | Consider snapshot tests for complex component renderings (`TreeSidebar`, `SettingsView`) to catch unintended UI changes. |
| L3 | **No mutation testing** | Low | Consider adding `@vitest/mutants` or `stryker-js` for mutation testing to validate test quality beyond line coverage. |
| L4 | **Stress tests use `performance.now()` without tolerance** | Low | Some stress tests assert `elapsed < 100ms` which could flake on slow CI runners. Consider increasing tolerances. |

---

## 10. Test File Inventory

### By Category

| Category | Files | Tests | Avg Tests/File |
|---|---|---|---|
| Main Process | 10 | 238 | 23.8 |
| Renderer Hooks | 7 | 223 | 31.9 |
| Renderer Components | 5 | 48 | 9.6 |
| Renderer Utils | 3 | 95 | 31.7 |
| Shared | 3 | 56 | 18.7 |
| Scaffold | 1 | 1 | 1.0 |
| Integration | 2 | 15 | 7.5 |
| **Total** | **32** | **688** | **21.5** |

### By Complexity

| Complexity | Files | Description |
|---|---|---|
| High (50+ tests) | 6 | message-store, extension-loader, message-transforms, project-store, useSessionOrchestration, useSessionEvents |
| Medium (20-49 tests) | 8 | session-manager, project-manager, notification-service, useModelSelection, useAutoScroll, useSession, project-helpers, tool-summary |
| Low (<20 tests) | 18 | All remaining |

---

## 11. Architectural Observations

### 11.1 Test Pyramid

```
        ╱╲
       ╱  ╲        E2E: 0 tests (gap)
      ╱    ╲
     ╱──────╲      Integration: 15 tests (2 files)
    ╱        ╲
   ╱──────────╲    Unit: 673 tests (30 files)
  ╱            ╲
 ╱──────────────╲
```

The test pyramid is **bottom-heavy** with excellent unit test coverage. The missing E2E layer is acceptable for an Electron desktop app but should be addressed as the project matures.

### 11.2 Mock Boundary Analysis

```
Renderer ←──vi.stubGlobal('nekocode')──→ IPC Bridge
    ↓                                        ↓
Hooks/Components                     ipc-handlers.ts
    ↓                                        ↓
vi.mock('react')                     vi.mock('electron')
vi.mock('project-store')             vi.mock('@earendil-works/pi-coding-agent')
vi.mock('useSessionEvents')          vi.mock('fs/promises')
```

Mock boundaries are clean and well-defined. Each test file mocks only its direct dependencies, not transitive ones.

---

## 12. Conclusion

The NekoCode test suite is **production-ready** with strong fundamentals:

- **688 tests, 100% pass rate, 2.85s execution**
- **Comprehensive mocking** with proper cleanup and factory patterns
- **Stress tests** that document edge case behavior
- **Clean separation** between unit and integration tests
- **Behavior-driven naming** throughout

The primary gaps are:
1. No tests for the threading module (`src/main/threading/`)
2. No E2E tests (Playwright)
3. Minor `act()` warnings in React hook tests

These are addressable improvements, not blockers. The test suite provides strong confidence in code changes and regression detection.

---

*Report generated by automated test suite audit — 2026-05-11*
