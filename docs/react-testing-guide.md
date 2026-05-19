# React Component Testing Guide — NekoCode (Short)

## 1. Core Principles
*   **Philosophy:** Focus on **Integration Tests**. They offer the highest ROI (Confidence ÷ Time).
*   **The Golden Rule:** Test your software the way it’s used. Test **behavior**, not implementation.
*   **Confidence Levels:**
    *   **Low:** Component renders without crashing.
    *   **High:** Component behaves correctly during user interaction (Type → Submit → View).
    *   **Highest:** End-to-end flow works (Open Session → AI Response).

## 2. What to Test (Use Case Coverage)
**Framework:** "If this were broken, how would the user know?"

| Priority | Category | Examples |
| :--- | :--- | :--- |
| **Must** | **Rendering** | Required props, empty/loading states, conditional sections. |
| **Must** | **Interaction** | Click handlers, keyboard shortcuts (Enter), form updates. |
| **Must** | **Async** | Loading indicators, streaming AI text, error messages. |
| **Must** | **Integration** | IPC calls (`window.nekocode`), Context consumption. |
| **Should** | **A11y** | ARIA roles, keyboard focus, screen reader labels. |

**P0 Priorities:** `ChatView`, `ChatInput`, `MessagesTimeline`.
**P1 Priorities:** `TreeSidebar`, `SessionView`, `AssistantMessage`.

## 3. What NOT to Test
*   **Implementation Details:** Internal state names, `useEffect` triggers, or component structure.
*   **Third-party Libs:** Don't test if Radix UI or Lucide icons work.
*   **Styling:** Avoid CSS class assertions (e.g., `toHaveClass('bg-red-500')`).
*   **The Rule:** If you refactor code but behavior stays the same and the test breaks, it was testing implementation details.

## 4. The Toolbox & Query Priority
**Stack:** Vitest + Testing Library + `user-event` + `jsdom`.

### Query Priority (High to Low)
1.  **`getByRole` (Best):** Matches the accessibility tree. `screen.getByRole('button', { name: /send/i })`.
2.  **`getByLabelText`:** For form fields.
3.  **`getByText`:** For non-interactive elements.
4.  **`getByTestId`:** Last resort only.

### Query Variants
*   **`getBy*`:** Expects element to exist **now**.
*   **`queryBy*`:** Use **only** for asserting non-existence (`expect(...).not.toBeInTheDocument()`).
*   **`findBy*`:** Use for **async** elements (returns a Promise).

## 5. Implementation Patterns

### Standard Test Anatomy
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockIPC, setupMockIPC, clearMockIPC } from '@/tests/__utils__/test-utils'

describe('Component', () => {
  beforeEach(() => setupMockIPC(createMockIPC()))
  afterEach(() => clearMockIPC())

  it('behaves correctly', async () => {
    const user = userEvent.setup()
    render(<MyComponent />)
    
    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.click(screen.getByRole('button', { name: /send/i }))
    
    expect(await screen.findByText(/success/i)).toBeInTheDocument()
  })
})
```

### Async Rules (`waitFor`)
1.  **One assertion** per `waitFor`.
2.  **No side effects** inside `waitFor` (don't click inside it).
3.  Prefer `findBy*` over `await waitFor(() => getBy*)`.

### Mocking IPC
Use the built-in `createMockIPC` utility.
```tsx
const mockIPC = createMockIPC()
vi.mocked(mockIPC.session.sendMessage).mockResolvedValue('msg-id')
```

## 6. Anti-Patterns to Avoid
*   🔴 **`fireEvent`:** Use `userEvent` instead (simulates real keyboard/mouse).
*   🔴 **Manual `act()`:** `render` and `userEvent` already wrap in `act()`.
*   🔴 **Snapshotting Components:** Leads to low-confidence tests that break on any HTML change.
*   🔴 **Leaking Mocks:** Always clean up IPC and timers in `afterEach`.
*   🔴 **Destructuring `render`:** Use `screen.getBy...` instead.

## 7. Final Checklist

### Per-Test
- [ ] Uses `// @vitest-environment jsdom`.
- [ ] Queries primarily by **Role**.
- [ ] Uses `userEvent.setup()`.
- [ ] Cleans up IPC with `clearMockIPC()`.
- [ ] Tests behavior, not state/classes.

### Performance & Quality
- [ ] No empty `waitFor` callbacks.
- [ ] `queryBy` used only for "not in document" checks.
- [ ] Async elements use `await findBy*`.
- [ ] Test names describe the **user outcome** (e.g., "shows error when API fails").