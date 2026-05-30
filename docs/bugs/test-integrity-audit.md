# Test Integrity Audit Report — NekoCode

**Date:** 2026-05-30
**Auditor:** Test Integrity Auditor Skill
**Scope:** All test files under `src/tests/`
**Status:** ✅ ALL ISSUES FIXED — See `contract-alignment-fixes-2026-05-30.md` for details

---

## Executive Summary

This audit identified **13 bent tests** across 5 test files. A bent test is one that documents a bug, contract violation, or known flaw in its comments — then asserts the **buggy** behavior as a passing condition, ensuring the build stays green while the flaw persists.

The most severe pattern is **enshrined redundancy** (extractDiffStats called 3x per tool call), where the test acknowledges it's a performance/correctness bug but asserts `toHaveBeenCalledTimes(3)` as the expected behavior. The second most severe pattern is **enshrined absence** (non-file tools have no interactive role), where accessibility violations are documented but tests assert `role === null` as correct.

---

## Finding 1: ToolCallSection.test.tsx — Enshrined Redundant Computation (3x Call Bug)

**File:** `src/tests/renderer/ToolCallSection.test.tsx`
**Lines:** 61–103
**Audit Header:** "extractDiffStats is called 3x per tool call — redundant computation, potential bug if function has side effects"

### Bent Test 1.1 — `it("calls extractDiffStats 3x per tool call — totalAdded + totalRemoved + row")`
```typescript
// Line 62–76: Asserts the BUG (6 calls for 2 tool calls) as correct
expect(mockExtractDiffStats).toHaveBeenCalledTimes(6)
```
**Why it's bent:** The audit header explicitly calls this "redundant computation, potential bug." Yet the test asserts `toHaveBeenCalledTimes(6)` — enshrining the 3x-per-call redundancy as correct. If the implementation is fixed to cache the result, this test breaks.

**Correct assertion:**
```typescript
test.fails("calls extractDiffStats once per tool call (cached)", () => {
  mockExtractDiffStats.mockReturnValue({ added: 1, removed: 0 })
  render(<ToolCallGroup toolCalls={[{ ...baseToolCall, id: "tc-1" }, { ...baseToolCall, id: "tc-2" }]} />)
  expect(mockExtractDiffStats).toHaveBeenCalledTimes(2) // 1 per tool call
})
```

### Bent Test 1.2 — `it("calls extractDiffStats 3x for a single tool call with diff stats")`
```typescript
// Line 83–95: Asserts the BUG (3 calls for 1 tool call) as correct
expect(mockExtractDiffStats).toHaveBeenCalledTimes(3)
```
**Why it's bent:** Same enshrined redundancy. The audit comment says "redundant computation, potential bug." The test asserts the bug.

**Correct assertion:**
```typescript
test.fails("calls extractDiffStats once for a single tool call (cached)", () => {
  mockExtractDiffStats.mockReturnValue({ added: 5, removed: 2 })
  render(<ToolCallGroup toolCalls={[baseToolCall]} />)
  expect(mockExtractDiffStats).toHaveBeenCalledTimes(1)
})
```

### Bent Test 1.3 — `it("if extractDiffStats had side effects, they would fire 3x per tool call")`
```typescript
// Line 104–121: Asserts the BUG (3 side effects for 1 call) as correct
expect(sideEffectCounter).toHaveBeenCalledTimes(3)
```
**Why it's bent:** This test explicitly demonstrates the *consequence* of the bug (3 side effects) and asserts it as expected. The comment even says "the function should be called once per tool call and the result cached."

**Correct assertion:**
```typescript
test.fails("extractDiffStats side effects fire only once per tool call (cached)", () => {
  const sideEffectCounter = vi.fn()
  mockExtractDiffStats.mockImplementation(() => {
    sideEffectCounter()
    return { added: 1, removed: 0 }
  })
  render(<ToolCallGroup toolCalls={[baseToolCall]} />)
  expect(sideEffectCounter).toHaveBeenCalledTimes(1)
})
```

---

## Finding 2: ToolCallSection.test.tsx — Enshrined Accessibility Absence

**File:** `src/tests/renderer/ToolCallSection.test.tsx`
**Lines:** 113–119
**Audit Header:** "ToolCallRow only fires onClick for file-modifying tools — non-file tools are NOT interactive, but there's no visual indicator"

### Bent Test 2.1 — `it("non-file-modifying tool has no button role")`
```typescript
// Line 113–119: Asserts the ACCESSIBILITY BUG (no role) as correct
const row = container.querySelector("[class*='px-3']")
expect(row?.getAttribute("role")).toBeNull()
```
**Why it's bent:** The audit header says non-file tools have "no visual indicator" of their non-interactive state. This is an accessibility violation — elements that look clickable but have no ARIA role. The test asserts `role === null` (the bug) instead of demanding an appropriate role.

**Correct assertion:**
```typescript
test.fails("non-file-modifying tool has appropriate ARIA role indicating non-interactive", () => {
  mockExtractDiffStats.mockReturnValue(null)
  const { container } = render(<ToolCallGroup toolCalls={[baseToolCall]} />)
  const row = container.querySelector("[class*='px-3']")
  // Should have role="listitem" or similar, not null
  expect(row?.getAttribute("role")).not.toBeNull()
})
```

---

## Finding 3: ToolCallSection.test.tsx — Enshrined Visibility Ambiguity

**File:** `src/tests/renderer/ToolCallSection.test.tsx`
**Lines:** 185–200
**Audit Header:** "DiffStatsBadge renders NOTHING when stats are { added: 0, removed: 0 } — ambiguous: is it 'no changes' or 'not applicable'?"

### Bent Test 3.1 — `it("stats with added:0, removed:0 renders no visible text — same as null stats")`
```typescript
// Line 186–200: Asserts the AMBIGUITY BUG (invisible badge) as correct
expect(greenText).toBeNull()
expect(redText).toBeNull()
```
**Why it's bent:** The audit header identifies this as ambiguous — the user cannot distinguish "file was written but nothing changed" from "this tool doesn't modify files." The test asserts the invisible state instead of demanding a distinguishing indicator.

**Correct assertion:**
```typescript
test.fails("zero-stats badge shows a distinguishing indicator (not invisible)", () => {
  mockExtractDiffStats.mockReturnValue({ added: 0, removed: 0 })
  const { container } = render(<ToolCallGroup toolCalls={[{ ...baseToolCall, toolName: "write" }]} />)
  // Should render something like "0 changes" or a neutral indicator
  // Not the same as null stats (which means "not applicable")
  const badge = container.querySelector("[data-diff-badge]")
  expect(badge).not.toBeNull()
})
```

---

## Finding 4: tool-summary.test.ts — Enshrined Empty-Content Bug

**File:** `src/tests/shared/tool-summary.test.ts`
**Lines:** 40–52
**Audit Comment:** "BUG: A valid write operation that clears a file is silently dropped from diff stats."

### Bent Test 4.1 — `it('empty string content returns null — valid write operation is silently dropped')`
```typescript
// Line 40–52: Asserts the BUG (null return for valid empty write) as correct
const result = extractDiffStats('write', { path: '/f', content: '' }, null)
expect(result).toBeNull()
```
**Why it's bent:** The comment says "BUG: writing empty content should be tracked as a change." The function treats empty string as falsy, silently dropping a valid operation. The test asserts `toBeNull()` — enshrining the bug.

**Correct assertion:**
```typescript
test.fails("empty string content is tracked as a valid write (not silently dropped)", () => {
  const result = extractDiffStats('write', { path: '/f', content: '' }, null)
  expect(result).not.toBeNull()
  // Should return { added: 0, removed: 0, estimated: true } or similar
})
```

### Bent Test 4.2 — `it('write where previousContent is empty string and content is empty string — returns null (BUG)')`
```typescript
// Lines 282–296: Asserts the BUG (null for empty-to-empty write) as correct
const result = extractDiffStats('write', { path: '/f', content: '' }, { previousContent: '' })
expect(result).toBeNull()
```
**Why it's bent:** The comment says "BUG: 'no change' and 'not applicable' are conflated." The function should return `{ added: 0, removed: 0 }` to indicate "written but nothing changed," not `null` (which means "not applicable"). The test asserts `toBeNull()`.

**Correct assertion:**
```typescript
test.fails("empty-to-empty write returns { added: 0, removed: 0 }, not null", () => {
  const result = extractDiffStats('write', { path: '/f', content: '' }, { previousContent: '' })
  expect(result).toEqual({ added: 0, removed: 0 })
})
```

---

## Finding 5: tool-summary.test.ts — Enshrined Critical Diff Failure (5001-line File)

**File:** `src/tests/shared/tool-summary.test.ts`
**Lines:** 242–259
**Audit Comment:** "This is a CRITICAL bug: a 5001-line file completely rewritten shows 'no changes'."

### Bent Test 5.1 — `it('large file fallback: same line count but all different content shows ZERO changes')`
```typescript
// Line 242–259: Asserts the CRITICAL BUG (0 changes for completely different file) as correct
expect(result).toEqual({ added: 0, removed: 0 })
```
**Why it's bent:** The comment says "CRITICAL bug" — a completely rewritten file shows zero changes. This is a data-integrity failure in the diff algorithm. The test asserts the wrong result instead of flagging it.

**Correct assertion:**
```typescript
test.fails("large file with all different content shows non-zero changes (not broken fallback)", () => {
  const oldLines = Array.from({ length: 5001 }, (_, i) => `old-line-${i}`)
  const newLines = Array.from({ length: 5001 }, (_, i) => `new-line-${i}`)
  const result = extractDiffStats('write', { path: '/f', content: newLines.join('\n') }, { previousContent: oldLines.join('\n') })
  expect(result!.added).toBeGreaterThan(0)
  expect(result!.removed).toBeGreaterThan(0)
})
```

---

## Finding 6: tool-summary.test.ts — Enshrined Reordering Invisibility

**File:** `src/tests/shared/tool-summary.test.ts`
**Lines:** 203–215
**Audit Comment:** "CONTRACT VIOLATION: Lines were reordered but the 'diff' says nothing changed."

### Bent Test 6.1 — `it('reordering identical lines shows ZERO changes — reordering is invisible')`
```typescript
// Line 203–215: Asserts the CONTRACT VIOLATION (0 changes for reordered lines) as correct
expect(result).toEqual({ added: 0, removed: 0 })
```
**Why it's bent:** The comment says "CONTRACT VIOLATION." The set-based diff cannot detect line reordering, which is a meaningful change. The test asserts the wrong output.

**Correct assertion:**
```typescript
test.fails("reordering lines is detected as a change (not invisible)", () => {
  const result = extractDiffStats('write', { path: '/f', content: 'b\na' }, { previousContent: 'a\nb' })
  expect(result!.added + result!.removed).toBeGreaterThan(0)
})
```

---

## Finding 7: useAutoScroll.test.ts — Enshrined Unhandled Exception

**File:** `src/tests/renderer/useAutoScroll.test.ts`
**Lines:** 502–520
**Audit Comment:** "This test documents a potential bug: the hook does not handle ResizeObserver constructor/observe errors gracefully"

### Bent Test 7.1 — `it('BUG: throws when ResizeObserver throws during observe', async () => {`
```typescript
// Line 502–520: Asserts the BUG (unhandled exception) as correct
expect(() => {
  renderHook((o) => useAutoScroll(o), { initialProps: opts })
}).toThrow('ResizeObserver error')
```
**Why it's bent:** The test name includes "BUG" and the comment says "the hook does not handle ResizeObserver errors gracefully." Yet the test asserts `toThrow()` — confirming the exception propagates instead of being caught. A robust hook should catch this and degrade gracefully.

**Correct assertion:**
```typescript
test.fails("gracefully handles ResizeObserver errors instead of throwing", () => {
  const errorRO = vi.fn(() => { throw new Error('ResizeObserver error') })
  globalThis.ResizeObserver = class { observe = errorRO; unobserve = vi.fn(); disconnect = vi.fn() } as unknown as typeof ResizeObserver
  const opts = makeOpts()
  // Should NOT throw — should degrade gracefully
  expect(() => {
    renderHook((o) => useAutoScroll(o), { initialProps: opts })
  }).not.toThrow()
})
```

---

## Finding 8: SessionDiffView.test.tsx — Enshrined File Count Bug

**File:** `src/tests/renderer/SessionDiffView.test.tsx`
**Lines:** 83–92
**Audit Comment:** "CONTRACT VIOLATION: Two diffs for the same file are shown separately."

### Bent Test 8.1 — `it("renders 1 file changed for 2 entries on same file — count is wrong")`
```typescript
// Line 87–92: Asserts the BUG (counting 2 files when it's really 1) as correct
expect(screen.getByText("2 files changed")).toBeTruthy()
```
**Why it's bent:** The test name says "count is wrong" and the audit says "CONTRACT VIOLATION." Two edits to the same file should show "1 file changed," not "2 files changed." The test asserts the wrong count.

**Correct assertion:**
```typescript
test.fails("shows correct file count (1 file) for 2 entries on same file", () => {
  const entries = [
    makeEntry({ id: "e1", filePath: "/same/file.ts" }),
    makeEntry({ id: "e2", filePath: "/same/file.ts" }),
  ]
  render(<SessionDiffView entries={entries} />)
  expect(screen.getByText("1 file changed")).toBeTruthy()
})
```

---

## Finding 9: useCommandHistory.test.ts — Enshrined Stale Source Bug

**File:** `src/tests/renderer/useCommandHistory.test.ts`
**Lines:** 137–149
**Audit Comment:** "BUG/AMBIGUITY: The source from the FIRST call is preserved, not updated."

### Bent Test 9.1 — Record with different sources preserves latest source
```typescript
// Line 137–149: Asserts the BUG (stale source) as correct...
// WAIT — this test actually asserts `expect(history[0].source).toBe('palette')`
// and the comment says "CORRECT behavior: the latest source ('palette') should win."
// This test expects the CORRECT behavior but the comment says the bug is that
// the FIRST source is preserved. If the implementation preserves the first source,
// this test should FAIL (and be wrapped in test.fails).
```
**Status: NEEDS VERIFICATION** — The test asserts the correct contract (`source === 'palette'`) but the comment says the implementation preserves the first source. If the test passes, either the bug was fixed or the comment is stale. If the test fails, it should be wrapped in `test.fails()`.

---

## Summary Table

| # | File | Line | Pattern | Bug Documented? | Assertion Matches Bug? | Severity |
|---|------|------|---------|-----------------|----------------------|----------|
| 1.1 | ToolCallSection.test.tsx | 62 | Enshrined Redundancy | Yes (3x call = bug) | `toHaveBeenCalledTimes(6)` | High |
| 1.2 | ToolCallSection.test.tsx | 83 | Enshrined Redundancy | Yes (3x call = bug) | `toHaveBeenCalledTimes(3)` | High |
| 1.3 | ToolCallSection.test.tsx | 104 | Enshrined Redundancy | Yes (3x side effects = bug) | `toHaveBeenCalledTimes(3)` | High |
| 2.1 | ToolCallSection.test.tsx | 113 | Enshrined Absence | Yes (no ARIA role) | `role === null` | Medium |
| 3.1 | ToolCallSection.test.tsx | 186 | Enshrined Ambiguity | Yes (invisible badge) | `greenText === null` | Medium |
| 4.1 | tool-summary.test.ts | 40 | Enshrined Drop | Yes (valid write dropped) | `toBeNull()` | High |
| 4.2 | tool-summary.test.ts | 282 | Enshrined Conflation | Yes (null vs zero-change) | `toBeNull()` | Medium |
| 5.1 | tool-summary.test.ts | 242 | Enshrined Critical Failure | Yes (5001-line diff broken) | `toEqual({ added: 0, removed: 0 })` | Critical |
| 6.1 | tool-summary.test.ts | 203 | Enshrined Invisibility | Yes (reordering invisible) | `toEqual({ added: 0, removed: 0 })` | High |
| 7.1 | useAutoScroll.test.ts | 502 | Enshrined Exception | Yes (unhandled throw) | `toThrow()` | Medium |
| 8.1 | SessionDiffView.test.tsx | 87 | Enshrined Wrong Count | Yes (count is wrong) | `"2 files changed"` | Medium |
| 9.1 | useCommandHistory.test.ts | 137 | Possible Stale Source | Yes (stale source) | `toBe('palette')` — needs verification | Low |

**Total Bent Tests: 12 confirmed, 1 needs verification**

---

## Severity Distribution

- **Critical** (data-integrity failure in production): 1 — Finding 5.1 (5001-line diff shows zero changes)
- **High** (enshrined bugs that make fixes impossible without test breakage): 4 — Findings 1.1, 1.2, 1.3, 4.1, 6.1
- **Medium** (accessibility/UX issues enshrined as correct): 5 — Findings 2.1, 3.1, 4.2, 7.1, 8.1
- **Low** (needs verification): 1 — Finding 9.1

---

## Recommended Remediation Priority

1. **Finding 5.1** (Critical): The 5001-line diff fallback is broken and the test enshrines the broken output. Wrap in `test.fails()` immediately.
2. **Findings 1.1–1.3** (High): The extractDiffStats 3x-call pattern is the canonical example of test-bending. Convert to `test.fails()` with the correct assertion (1 call per tool call).
3. **Finding 4.1** (High): Empty-string writes being silently dropped is a data-loss-adjacent bug. Wrap in `test.fails()`.
4. **Finding 6.1** (High): Reordering invisibility is a fundamental limitation of the set-based diff. Document with `test.fails()`.
5. **Findings 2.1, 3.1, 4.2, 7.1, 8.1** (Medium): Accessibility and UX ambiguities. Wrap in `test.fails()`.
6. **Finding 9.1** (Low): Verify whether the test already asserts the correct behavior; if it fails, wrap in `test.fails()`.

---

## Methodology

1. **Broad structural sweep:** Searched all 64 test files for patterns: `contract`, `violation`, `audit`, `redundant`, `performance`, `bug`, `workaround`, `hack`, `bent`, `FIXME`, `TODO`.
2. **Semantic matching:** Read header audit comments and cross-referenced with assertion content. Flagged cases where the comment documents a bug but the assertion enshrines it.
3. **Contract analysis:** Verified each flagged test against the auditor's checklist:
   - Would fixing the bug break this test? → Yes = Bent
   - Does the test verify inefficiency? → Yes = Bent
   - Are default expectations dropped? → Yes = Bent
   - Are known violations marked with `test.fails()`? → No = Bent

---

*End of Audit Report*
