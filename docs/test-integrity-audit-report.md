# Test Integrity Audit Report — NekoCode

**Date:** 2026-05-29  
**Scope:** `src/tests/` (all test files)  
**Methodology:** Grep-based audit for contract debt markers, contradictory comments, weak assertions, and "CRITICAL TESTING" audit blocks per the Test Integrity Auditor skill.

---

## 1. Contract Debt Ledger

**Zero deferred tests found.** The codebase has **no** `test.fails()`, `test.todo()`, `test.skip()`, `xit`, or `xdescribe` markers anywhere in the test suite. This is notable — every identified contract violation is tested with normal `it()`/`test()` blocks, meaning the build is green **despite** known bugs being codified as expected behavior.

**Risk Assessment:** The absence of `test.fails()` is itself a red flag. Known bugs are being asserted as correct behavior rather than tracked as open issues.

---

## 2. Bent Test Findings

I identified **5 distinct bent-test categories** across the codebase:

---

### Finding 1: Shallow-Copy Mutation Leak Asserted as Expected

- **Location:** `src/tests/renderer/useCommandHistory.test.ts`
- **The Contradiction:** A comment explicitly labels the behavior as a **BUG** — `"getHistory returns a SHALLOW copy ([...history]), so the entry objects are shared references. Mutating an entry's properties leaks back into internal state. This is an abstraction leak."` Yet the assertion `expect(history2[0].name).toBe('MUTATED')` codified this leak as **expected behavior**.
- **Impact:** Any consumer of `getHistory()` can silently corrupt internal state. This is a real data-integrity bug hidden behind a green test.
- **Fix Applied:** Converted to `it.fails()` asserting the **correct** behavior: `expect(history2[0].name).toBe('help')` (deep-copy isolation). Test name updated to `returns a deep copy — entry objects should be isolated from internal state`.

---

### Finding 2: Stale `source` Field Asserted as Correct

- **Location:** `src/tests/renderer/useCommandHistory.test.ts`
- **The Contradiction:** Comment says `"BUG/AMBIGUITY: The source from the FIRST call is preserved, not updated."` Yet the assertion `expect(history[0].source).toBe('slash')` treated the stale `source` as correct expected output.
- **Impact:** `recordUsage('help', 'palette')` followed by `recordUsage('help', 'slash')` keeps `source='slash'` — the function silently drops context about where the command was used.
- **Fix Applied:** Converted to `it.fails()` asserting `expect(history[0].source).toBe('palette')` (latest source wins). Test name updated to `treats same name with different sources — latest source should win (currently stale)`.

---

### Finding 3: Non-Array JSON in localStorage Crash Asserted as Expected

- **Location:** `src/tests/renderer/useCommandHistory.test.ts`
- **The Contradiction:** Comment says `"BUG FOUND: The hook blindly casts JSON.parse result to CommandHistoryEntry[]. If the stored value is a non-iterable object, getHistory() crashes."` Yet the test **expected** the crash: `expect(() => result.current.getHistory()).toThrow(TypeError)`.
- **Impact:** Corrupted or tampered localStorage renders the command history feature completely unusable with an unhandled exception. This should be a graceful degradation.
- **Fix Applied:** Converted to `it.fails()` asserting graceful fallback: `expect(() => result.current.getHistory()).not.toThrow()` and `expect(result.current.getHistory()).toEqual([])`. Test name updated to `gracefully handles non-array JSON in localStorage — should return empty array, not crash`.

---

### Finding 4: `extractDiffStats` Naming Dishonesty — Write Without Previous Content

- **Location:** `src/tests/shared/tool-summary.test.ts`
- **The Contradiction:** The CRITICAL TESTING block states: `"The name says 'diff stats' but for write without previousContent, it does NOT diff — it counts lines. The name is dishonest."` The test asserted `expect(result).toEqual({ added: N, removed: 0 })` treating line counts as diff stats.
- **Impact:** UI shows "+5" for a file that was completely overwritten (possibly 0 net additions). Users see misleading change indicators.
- **Fix Applied:** Converted to `it.fails()` asserting `expect(result).toEqual({ added: 5, removed: 0, estimated: true })` — the function should include an `estimated` flag to distinguish guesses from actual diffs. Test name updated to `write without previousContent should indicate estimated stats, not definitive diff — the function cannot know`.

---

### Finding 5: `extractToolSummary` Produces Broken Output for Missing Path

- **Location:** `src/tests/shared/tool-summary.test.ts`
- **The Contradiction:** Comment says `"read with offset but no path produces ':10' — colon-prefixed nonsense"` and marks it as a `CONTRACT VIOLATION`. Yet the assertion `expect(extractToolSummary('read', { offset: 10 })).toBe(':10')` codified the broken output.
- **Impact:** Tool summary displays show broken strings like `:10` instead of meaningful descriptions.
- **Fix Applied:** Converted to `it.fails()` asserting `expect(extractToolSummary('read', { offset: 10 })).toBe('read (offset 10)')` — a meaningful fallback. Test name updated to `read with offset but no path should produce meaningful fallback, not colon-prefixed nonsense`.

---

## 3. Weak Assertion Strengthening

### git-operations-critical.test.ts

**4 weak assertions strengthened** — replaced `toBeDefined()` with specific value checks:

| Test | Before | After |
|------|--------|-------|
| `maxCount=-1` | `expect(result).toBeDefined()` | `expect(result).toEqual({ commits: [], total: 0 })` + `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 50 })` |
| `maxCount=Infinity` | `expect(result).toBeDefined()` | `expect(result).toEqual({ commits: [], total: 0 })` + `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 50 })` |
| `maxCount=1.5` | `expect(result).toBeDefined()` | `expect(result).toEqual({ commits: [], total: 0 })` + `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 1 })` |
| `maxCount=0` | `expect(result.commits).toHaveLength(0)` only | Added `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 50 })` |

### logger.test.ts

**2 weak assertions strengthened**:

| Test | Before | After |
|------|--------|-------|
| `winston logger has format property` | `expect(format).toBeDefined()` | `expect(typeof format).toBe("object")`, `expect(format).not.toBeNull()`, `expect(typeof format.transform).toBe("function")` |
| `winston logger has transports array` | `expect(Array.isArray(transports)).toBe(true)` | Added `expect(transports.length).toBeGreaterThan(0)` |

---

## 4. Additional Findings — Fixed

### 5a. Rogue Response Validation Gap

- **Location:** `src/tests/slash-commands-critical.test.ts`
- **Original:** Test asserted `expect(result).toBe('hacked-value-not-in-options')` — accepting arbitrary renderer values.
- **Fix Applied:** Added `it.fails()` test asserting `expect(['a', 'b']).toContain(result)` — the correct behavior where invalid selectedValue should be rejected or clamped. Original test preserved as documentation of current bug.

### 5b. Negative Timeout Silently Ignored

- **Location:** `src/tests/slash-commands-critical.test.ts`
- **Original:** Test had `expect(request).toBeDefined()` — weak assertion masking ambiguity.
- **Fix Applied:** Strengthened original test with `expect(request!.type).toBe('select')` and `expect(request!.prompt).toBe('Choose')`. Added `it.fails()` test asserting `expect(() => context.select('Choose', ['opt1'], { timeout: -100 })).toThrow()` — negative timeout should be rejected, not silently ignored.

### 5c. Dead Dependency Injection

- **Location:** `src/tests/threaded-project-manager.test.ts`
- **Original:** Test only verified `expect(mockQueue.execute).not.toHaveBeenCalled()` — documenting the bug but accepting it.
- **Fix Applied:** Added `it.fails()` test asserting `expect(mockQueue.execute).toHaveBeenCalled()` — the class is named "ThreadedProjectManager" and should use the queue. Original test preserved as documentation of current bug.

---

## 5. Summary of Changes

| Change Type | Count | Files Modified |
|-------------|-------|----------------|
| Bent tests converted to `it.fails()` | 5 | `useCommandHistory.test.ts`, `tool-summary.test.ts` |
| New `it.fails()` tests added for contract gaps | 3 | `slash-commands-critical.test.ts`, `threaded-project-manager.test.ts` |
| Weak assertions strengthened | 6 | `git-operations-critical.test.ts`, `logger.test.ts` |
| **Total test modifications** | **14** | **5 files** |

---

## 6. Policy Recommendation

**Any test that documents a bug in a comment should use `test.fails()` rather than asserting the buggy behavior.** The current pattern of "comment says it's broken, test says it's expected" is the definition of a bent test. The `test.fails()` marker converts hidden bugs into visible tracers that will automatically flip to passing once the implementation is fixed.
