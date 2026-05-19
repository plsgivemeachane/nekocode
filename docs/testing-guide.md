# NekoCode Test Design Guide

> Write the test **alongside** the feature, not after. This guide defines the patterns, conventions, and checklists that every developer must follow so that tests are complete at ship time — no retrofitting needed.

---

## 1. Testing Stack & Commands

| Tool | Purpose |
|------|---------|
| **Vitest** | Test runner (`bun run test`) |
| **@testing-library/react** | Component rendering, DOM queries, `renderHook` |
| **@testing-library/user-event** | Simulating real user interactions |
| **jsdom** | Browser-like environment for renderer tests |
| **vi.fn() / vi.mock()** | Mocking and spying |

**Always run:**
```powershell
bun run test          # vitest run (NOT bun test)
bun run lint          # eslint
bun run type-check    # tsc
```

---

## 2. File Structure & Naming

### Location Convention

```
src/tests/
├── __setup__/setup.ts              # Global setup (jest-dom matchers, scrollIntoView mock)
├── __utils__/test-utils.tsx        # Shared mock factories & helpers
├── <module>.test.ts                # Main-process unit tests
├── <module>.integration.test.ts    # Cross-boundary integration tests
├── main/                           # Main-process-specific tests
├── renderer/                       # Renderer component/hook/util tests
│   ├── <Component>.test.tsx        # Component tests (.tsx)
│   ├── <hook>.test.ts              # Hook tests (.ts)
│   └── <util>.test.ts              # Utility tests (.ts)
└── shared/                         # Shared-type pure-function tests
```

### Rules

1. **Test file mirrors source file path**: `src/main/stream-batcher.ts` → `src/tests/stream-batcher.test.ts`; `src/renderer/src/hooks/useAutoScroll.ts` → `src/tests/renderer/useAutoScroll.test.ts`
2. **Renderer tests go in `src/tests/renderer/`** with `@vitest-environment jsdom` directive.
3. **Component tests use `.tsx`**; hook and utility tests use `.ts`.
4. **Integration tests suffix**: `<module>.integration.test.ts` (e.g., `session-manager.integration.test.ts`).

---

## 3. Test Design Checklist (Per Feature)

Use this checklist when designing tests for a new feature. **Every item must be addressed before the PR is reviewable.**

### 3.1 Contract Audit

- [ ] List every public function/method/class the feature exposes.
- [ ] For each, write a test that verifies the **input→output contract** (happy path).
- [ ] Identify type-level promises (e.g., "source field includes 'workflow'") — write a test that proves or documents the gap.

### 3.2 Happy Path

- [ ] The primary use case works end-to-end with typical inputs.
- [ ] Default/optional parameters behave correctly when omitted.

### 3.3 Edge Cases & Error Paths

- [ ] Empty inputs (`[]`, `""`, `null`, `undefined`).
- [ ] Boundary values (max length, zero, negative).
- [ ] Error states: rejected promises, thrown exceptions, malformed data.
- [ ] Race conditions: concurrent calls, rapid state changes.

### 3.4 State Transitions

- [ ] Lifecycle: create → use → dispose (and double-dispose safety).
- [ ] State machines: idle → streaming → error → idle.
- [ ] Cleanup: event listeners removed, timers cleared, resources freed.

### 3.5 Integration Points

- [ ] IPC calls: does the feature call the correct channel with correct args?
- [ ] Event subscriptions: does the feature subscribe/unsubscribe correctly?
- [ ] Store updates: does state propagate to the store and back?
- [ ] Cross-boundary: main↔renderer, worker↔main.

---

## 4. Patterns by Feature Type

### 4.1 Pure Functions / Utilities (e.g., `message-transforms`, `chat-utils`, `tool-summary`)

**Pattern:** No mocks needed. Test input→output directly.

```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from '@/renderer/src/utils/my-util'

describe('myFunction', () => {
  it('returns expected result for typical input', () => {
    expect(myFunction('input')).toBe('expected')
  })

  it('handles empty input', () => {
    expect(myFunction('')).toBe('')
  })

  it('handles edge case X', () => {
    expect(myFunction('edge')).toBe('handled')
  })
})
```

**Naming convention:** Nested `describe` blocks group by category/behavior, each `it` describes the specific scenario.

---

### 4.2 Main-Process Modules (e.g., `stream-batcher`, `session-manager`, `message-store`)

**Pattern:** Mock external dependencies with `vi.mock()`. Use `vi.hoisted()` for shared mock state.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron ────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
}))

// ── Shared mock state (hoisted so it's available in vi.mock factories) ──
const mockState = vi.hoisted(() => ({
  someExternalCall: vi.fn(async () => 'mocked'),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: mockState.someExternalCall,
  // ... other exports
}))

// Import AFTER mocks
import { MyManager } from '../main/my-manager'

describe('MyManager', () => {
  let manager: MyManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new MyManager()
  })

  it('creates session with correct params', async () => {
    mockState.someExternalCall.mockResolvedValue({ sessionId: 's1' })
    const result = await manager.create('session-1', '/cwd')
    expect(result).toBe('s1')
    expect(mockState.someExternalCall).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/cwd' })
    )
  })
})
```

**Key rules for main-process tests:**
- Always mock `electron` (it's not available in test environment).
- Always mock `@earendil-works/pi-coding-agent` SDK.
- Use `vi.hoisted()` for mock state shared between `vi.mock()` factories and test bodies.
- Import the module under test **after** all `vi.mock()` calls.
- Call `vi.clearAllMocks()` in `beforeEach`.

---

### 4.3 Renderer Components (e.g., `ChatView`, `StatusIndicator`, `TreeSidebar`)

**Pattern:** Mock all child components and hooks. Use `@testing-library/react` for rendering and queries.

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { MyComponent } from '@/renderer/src/components/MyComponent'
import { setupMockIPC, clearMockIPC } from '../__utils__/test-utils'

// ── Mock hooks ───────────────────────────────────────────────────
const mockHook = {
  data: [],
  isLoading: false,
  action: vi.fn(),
}

vi.mock('@/renderer/src/hooks/useMyHook', () => ({
  useMyHook: () => mockHook,
}))

// ── Mock project store ───────────────────────────────────────────
vi.mock('@/renderer/src/stores/project-store', () => ({
  useProjectStore: () => ({ state: { activeProjectPath: '/test', agentReady: true } }),
}))

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockIPC()
  })

  afterEach(() => {
    clearMockIPC()
  })

  it('renders heading text', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('calls action on button click', async () => {
    const user = userEvent.setup()
    render(<MyComponent />)
    await user.click(screen.getByRole('button', { name: /submit/i }))
    expect(mockHook.action).toHaveBeenCalledOnce()
  })
})
```

**Key rules for component tests:**
- First line must be `// @vitest-environment jsdom`.
- Mock all hooks the component uses (`vi.mock` at module level).
- Mock the project store.
- Use `setupMockIPC()` / `clearMockIPC()` from `test-utils.tsx`.
- Prefer `screen.getByRole()` and `screen.getByText()` over test IDs.
- Use `userEvent` for interactions (not `fireEvent`).

---

### 4.4 Custom Hooks (e.g., `useAutoScroll`, `useSession`, `useClickOutside`)

**Pattern:** Use `renderHook` from `@testing-library/react`. Wrap state updates in `act()`.

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMyHook } from '@/renderer/src/hooks/useMyHook'

describe('useMyHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial state', () => {
    const { result } = renderHook(() => useMyHook({ enabled: true }))
    expect(result.current.value).toBe(0)
  })

  it('increments on action call', () => {
    const { result } = renderHook(() => useMyHook({ enabled: true }))
    act(() => {
      result.current.increment()
    })
    expect(result.current.value).toBe(1)
  })

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() => useMyHook({ enabled: true }))
    unmount()
    // Verify cleanup: listeners removed, timers cleared
  })
})
```

**Key rules for hook tests:**
- First line must be `// @vitest-environment jsdom`.
- Use `renderHook()` — never try to call hooks outside a component.
- Wrap imperative calls (e.g., `result.current.increment()`) in `act()`.
- Always test cleanup/unmount behavior.
- For hooks using timers, use `vi.useFakeTimers()` + `vi.advanceTimersByTime()`.

---

### 4.5 Integration Tests (e.g., `session-manager.integration.test.ts`, `ipc-handlers.integration.test.ts`)

**Pattern:** Test the wiring between modules. Mock only the outermost boundary (SDK, Electron IPC). Let internal modules interact naturally.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Only mock the external boundary
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  // Full SDK mock
}))

// Import real modules — they interact with each other
import { PiSessionManager } from '../main/session-manager'
import { registerIpcHandlers } from '../main/ipc-handlers'

describe('Session IPC Integration', () => {
  it('ipc handler creates session through manager', async () => {
    // Set up real manager + real IPC wiring
    // Verify the IPC call reaches the manager and returns correctly
  })
})
```

**Key rules for integration tests:**
- File suffix: `.integration.test.ts`.
- Mock only the outermost boundary (SDK, Electron).
- Let internal modules interact — that's what you're testing.
- Test the full request→response flow across module boundaries.

---

### 4.6 Shared Types & Constants (e.g., `ipc-channels`, `chat-utils`)

**Pattern:** Test structural invariants — uniqueness, naming conventions, completeness.

```typescript
import { describe, it, expect } from 'vitest'
import { MY_CHANNELS } from '@/shared/my-channels'

describe('MY_CHANNELS', () => {
  it('has no duplicate values', () => {
    const values = Object.values(MY_CHANNELS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('all values follow naming convention', () => {
    for (const v of Object.values(MY_CHANNELS)) {
      expect(v).toMatch(/^[a-z]+:[a-zA-Z-]+$/)
    }
  })

  it('has all required channels', () => {
    expect(MY_CHANNELS).toHaveProperty('FOO_CREATE')
    expect(MY_CHANNELS).toHaveProperty('FOO_DELETE')
  })
})
```

---

## 5. Shared Test Utilities (`test-utils.tsx`)

Always use these before writing your own mock factories:

| Helper | Purpose |
|--------|---------|
| `createMockIPC()` | Full `NekoCodeIPC` mock with sensible defaults |
| `setupMockIPC(overrides?)` | Sets `window.nekocode` for renderer tests |
| `clearMockIPC()` | Removes `window.nekocode` after test |
| `createSessionManagerMock(overrides?)` | Main-process `PiSessionManager` mock |
| `createProjectManagerMock(overrides?)` | Main-process `ProjectManager` mock |
| `createEventEmitter()` | Manual event emitter for `onEvent` subscription tests |
| `makeTextDeltaEvent(delta)` | Factory: text_delta `SessionStreamEvent` |
| `makeToolCallEvent(name, id, args)` | Factory: tool_call `SessionStreamEvent` |
| `makeToolResultEvent(name, id, result)` | Factory: tool_result `SessionStreamEvent` |
| `makeDoneEvent()` | Factory: done `SessionStreamEvent` |
| `makeUserMessageEvent(text)` | Factory: user_message `SessionStreamEvent` |

**When adding a new IPC API:** Add the mock to `createMockIPC()` in `test-utils.tsx` so all existing and future tests automatically get the new mock.

---

## 6. Mocking Rules

### 6.1 Module Mocking Order (CRITICAL)

```typescript
// 1. Declare hoisted mock state (available inside vi.mock factories)
const mockState = vi.hoisted(() => ({
  myFn: vi.fn(),
}))

// 2. Define vi.mock() calls
vi.mock('external-module', () => ({
  myFn: mockState.myFn,
}))

// 3. Import the module under test (AFTER all mocks)
import { MyModule } from '../main/my-module'
```

**Never** import the module under test before `vi.mock()` calls. Vitest hoists `vi.mock()`, but explicit `vi.hoisted()` is required for shared state.

### 6.2 What to Mock vs. What Not to Mock

| Mock It | Don't Mock It |
|---------|--------------|
| `electron` (always) | The module under test |
| `@earendil-works/pi-coding-agent` SDK | Vitest utilities |
| `@testing-library` can't access it | Internal utility functions (test them separately) |
| Child components in component tests | The component being tested |
| Hooks consumed by a component | The hook being tested (in hook tests) |
| `window.nekocode` IPC | DOM APIs (use jsdom) |
| File system / network | Pure logic and transforms |

### 6.3 Mocking Hooks in Component Tests

Use a **module-level const** with all mock implementations, then `vi.mock` returns it:

```typescript
const mockUseSession = {
  messages: [],
  isStreaming: false,
  sendPrompt: vi.fn(() => Promise.resolve()),
}

vi.mock('@/renderer/src/hooks/useSession', () => ({
  useSession: () => mockUseSession,
}))
```

This lets you modify `mockUseSession.messages` in individual tests without re-mocking.

---

## 7. Test Structure Template

Every test file follows this structure:

```typescript
// @vitest-environment jsdom              ← Only for renderer tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'  ← If needed
import userEvent from '@testing-library/user-event'            ← If needed
import React from 'react'                                      ← If .tsx

// ── Mocks ────────────────────────────────────────────────────────
// vi.hoisted() → vi.mock() → import module

// ── Helpers ──────────────────────────────────────────────────────
// Factory functions for test data (makeUserMessage, createMockSession, etc.)

// ── Tests ────────────────────────────────────────────────────────
describe('ModuleName', () => {
  // Lifecycle
  beforeEach(() => { vi.clearAllMocks(); /* setup */ })
  afterEach(() => { /* cleanup */ })

  // Happy path
  it('does X when Y', () => { ... })

  // Edge cases
  it('handles empty input', () => { ... })
  it('handles error from dependency', () => { ... })

  // State transitions (if applicable)
  describe('lifecycle', () => {
    it('creates with defaults', () => { ... })
    it('disposes cleanly', () => { ... })
    it('double-dispose is safe', () => { ... })
  })
})
```

---

## 8. Anti-Patterns to Avoid

| ❌ Don't | ✅ Do |
|----------|-------|
| Write tests after the feature is "done" | Write tests alongside the feature, in the same PR |
| Use `fireEvent` for user interaction | Use `userEvent` (simulates real user behavior) |
| Test implementation details (`.state`, internal vars) | Test observable behavior (output, DOM, calls) |
| Hard-code mock return values in `vi.mock()` factories | Use `mockResolvedValue`/`mockReturnValue` in `beforeEach` or individual tests |
| Create a new mock factory per test | Add to `test-utils.tsx` if it's reusable |
| Skip testing cleanup/unmount | Always verify `dispose`, `unmount`, listener removal |
| Use `testId` queries as first choice | Use `getByRole`, `getByText`, `getByLabelText` first |
| Import module before `vi.mock()` | Import after — order matters |
| Forget `@vitest-environment jsdom` on renderer tests | Always add it as the first line |
| Run `bun test` | Run `bun run test` (uses vitest, not bun's runner) |

---

## 9. Quick Reference: Adding a New Feature

When adding a new feature, follow these steps **in order**:

1. **Identify the feature type** (pure function / main-process module / renderer component / hook / shared type).
2. **Create the test file** in the correct location with the correct naming convention.
3. **Write the Contract Audit** — list every public API and write a test for each.
4. **Write the Happy Path test** — the primary use case works.
5. **Write Edge Case tests** — empty, boundary, error, race conditions.
6. **Write State Transition tests** — lifecycle, state machines, cleanup.
7. **Write Integration tests** (if the feature crosses boundaries) — `.integration.test.ts`.
8. **Update `test-utils.tsx`** if you added a new IPC API or mock-able interface.
9. **Run `bun run test && bun run lint && bun run type-check`** — all must pass.
