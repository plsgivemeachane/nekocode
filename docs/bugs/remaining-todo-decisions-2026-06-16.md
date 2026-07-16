# Remaining TODO Decision Sheet — 25 Items

**Date:** 2026-06-16  
**Source:** `docs/bugs/critical-contract-violation-fixes-2026-06-16.md`  
**Current state:** 1768 tests passing, 25 `test.todo` items remain  

Fill in your answer for each question by replacing `[ ]` with `[x]` next to your choice,  
or writing your answer in the `Freeform:` line. Then this file becomes the decision record.

---

## Module 1: usePolling (1 item)

### Q1. Per-tick timeout for hanging `onPoll`

**Context:** If `onPoll` never resolves, all future polling is blocked forever. A per-tick timeout (e.g., `AbortController` + `setTimeout`) would allow the next tick to fire even if the current one hangs. However, this adds complexity and a new config option.

**Current behavior:** A hanging `onPoll` blocks all future ticks indefinitely.

- [ ] A) **Implement per-tick timeout.** Add `tickTimeoutMs?: number` option (default: 30000). If `onPoll` exceeds it, treat as error and schedule next tick.
- [ ] B) **Document the limitation.** Add JSDoc warning that `onPoll` must not hang. Keep implementation simple.
- [ ] C) **Skip / Defer.** Not a real-world issue; `onPoll` calls IPC which always resolves or rejects.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 2: StreamBatcher (3 items)

### Q2. `dispose()` flag — push() should be no-op after dispose

**Context:** Currently, calling `push()` after `dispose()` still works — the batcher accepts and flushes events. This is a resource leak risk.

- [ ] A) **Implement dispose flag.** `push()` becomes silent no-op after `dispose()`. Set `_disposed = true` in `dispose()`.
- [ ] B) **Throw after dispose.** `push()` throws an error if called after `dispose()`, making the bug loud.
- [ ] C) **Skip / Defer.** Current behavior is harmless — events just get flushed once more.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q3. Thinking-before-text flush order should be documented

**Context:** The batcher always flushes pending thinking before pending text. This is a critical but undocumented contract. Callers may depend on it without realizing.

- [ ] A) **Add JSDoc documentation** on `StreamBatcher` class and `push()` method documenting the flush-order guarantee.
- [ ] B) **Add a `FLUSH_ORDER` constant** and reference it in code comments + JSDoc.
- [ ] C) **Skip / Defer.** Internal implementation detail; documenting it creates a public commitment.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q4. Expose `hasPending` readonly property

**Context:** There is no way to inspect whether the batcher has unflushed data. Callers who want "flush before close" logic must blindly call `flush()` (which is a no-op when empty).

- [ ] A) **Add `get hasPending(): boolean`.** Returns `this.pendingText.length > 0 || this.pendingThinking.length > 0`.
- [ ] B) **Add `flush()` return value.** Make `flush()` return `boolean` indicating whether anything was flushed, instead of a separate property.
- [ ] C) **Skip / Defer.** `flush()` is already a safe no-op; no real need for introspection.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 3: AgentEventProcessor (6 items)

### Q5. `handleAgentEvent` should return `Result<void, Error>` or accept `onError` callback

**Context:** Currently `handleAgentEvent` returns `void`. Callers have no way to know if processing succeeded or partially failed (callbacks might have thrown, but were caught internally).

- [ ] A) **Return `Result<void, Error>`.** Change return type to `{ ok: true } | { ok: false; error: Error }`. Breaking change but explicit.
- [ ] B) **Accept `onError` callback.** Add optional `onError?: (error: Error) => void` to constructor options. Non-breaking.
- [ ] C) **Both A and B.** Return Result AND accept onError for maximum flexibility.
- [ ] D) **Skip / Defer.** Current try/catch + logging is sufficient for production.
- [ ] E) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q6. `finalizeAssistantMessage` / `finalizeThinkingMessage` should return boolean

**Context:** Currently these return `void`. If no message exists to finalize, the call is a silent no-op. Returning `boolean` would let callers know if finalization actually occurred.

- [ ] A) **Return `boolean`.** `true` if a message was finalized, `false` if nothing to finalize. Simple, non-breaking in practice (void callers ignore return).
- [ ] B) **Return `string | null`.** Return the finalized message ID, or `null` if nothing was finalized. More informative.
- [ ] C) **Skip / Defer.** Callers don't need to know; the no-op is harmless.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q7. `handleAgentEvent` should validate `sessionId` is a non-empty string

**Context:** Empty string `sessionId` is accepted without validation. Events with `sessionId = ""` are processed and emitted, but downstream consumers may misbehave.

- [ ] A) **Validate and throw.** Throw `Error` if `sessionId` is empty or not a string. Loud failure.
- [ ] B) **Validate and log warning.** Log a warning but still process the event. Soft guard.
- [ ] C) **Skip / Defer.** The type system already constrains this; runtime validation is over-engineering.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q8. Out-of-order events (delta without start) should be detected and logged as warnings

**Context:** Receiving `text_delta` before `message_start` auto-creates a message with a random UUID. This silent auto-creation hides bugs in the event stream producer.

- [ ] A) **Log warnings.** Detect out-of-order events and `console.warn` with details. Still auto-create for resilience.
- [ ] B) **Throw on out-of-order.** Treat as a contract violation and throw. Strict mode.
- [ ] C) **Skip / Defer.** Auto-creation is actually a useful resilience feature; logging would be noisy.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q9. Deterministic ID generator injected via options

**Context:** `crypto.randomUUID()` is used for ID generation, making tests non-deterministic. Injecting an ID generator would improve testability.

- [ ] A) **Add `idGenerator?: () => string` to options.** Default to `crypto.randomUUID`. Tests inject a counter.
- [ ] B) **Skip / Defer.** Tests already work with non-deterministic IDs; the current approach is fine.
- [ ] C) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q10. Unknown event types should be logged as warnings

**Context:** The switch statement has no `default` case. Unknown event types are silently dropped. If a new event type is added to the SDK but not handled here, it's invisible.

- [ ] A) **Add `default` case with `console.warn`.** Log unknown event type for debuggability.
- [ ] B) **Add `default` case with `console.warn` + option to throw.** Configurable strictness.
- [ ] C) **Skip / Defer.** Silently dropping unknowns is correct behavior — forward-compatible.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 4: IPC Router (2 items)

### Q11. `sendToRenderer` — broadcast to all windows or target specific one?

**Context:** Currently `sendToRenderer` sends to the first non-destroyed window only. If multiple windows are open, only the first one receives the message. This may or may not be the desired behavior.

- [ ] A) **Keep current behavior.** Send to first window only. Simple, matches current usage.
- [ ] B) **Add `targetWindowId?: string` parameter.** Default to first window (backward compatible), but allow targeting.
- [ ] C) **Broadcast to all windows.** Change default to send to all non-destroyed windows.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q12. `registerRendererListener` — remove or implement?

**Context:** `registerRendererListener` exists in the API but does nothing at runtime (just `console.warn`s). It's a "type-level utility" that tricks TypeScript into thinking listeners work. This is confusing.

- [ ] A) **Remove from runtime API.** Delete the function entirely. Move to a type-only declaration if needed.
- [ ] B) **Implement properly.** Use `ipcRenderer.on` to actually register the listener.
- [ ] C) **Keep as-is but improve the warning.** Make the `console.warn` more prominent (e.g., include stack trace).
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 5: Message Grouping (3 items)

### Q13. Should single tool_call/thinking be a "single" group instead of "tool-group"/"thinking-group"?

**Context:** A single `tool_call` message creates a `tool-group` (with 1 item). A single `thinking` creates a `thinking-group` (with 1 item). An alternative is to create a `single` group for solo items, reserving group types for 2+ items.

- [ ] A) **Keep current behavior.** A single tool_call is still a `tool-group` with 1 item. Simpler logic.
- [ ] B) **Change to `single` for solo items.** Only use `tool-group`/`thinking-group` when there are 2+ items. More semantically correct.
- [ ] C) **Skip / Defer.** This affects ChatView rendering; needs UX review first.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q14. `UIDialogGroup` and `WorkflowStepGroup` — produce or remove?

**Context:** These types exist in the `MessageGroup` union but are never produced by `groupMessages()`. ChatView pushes them manually. This creates "false exhaustiveness" — switch statements must handle types that never appear from the grouping function.

- [ ] A) **Remove from the union.** Move them to a separate type. `groupMessages()` only produces `single | tool-group | thinking-group`.
- [ ] B) **Produce them in `groupMessages()`.** Add detection logic for UI dialog and workflow step messages.
- [ ] C) **Keep as-is.** The union type represents ALL possible groups, not just those from `groupMessages()`. Document this distinction.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q15. Normalize key format for all group types

**Context:** `SingleGroup` keys have no prefix (`"1"`), while `ToolGroup` uses `"tg-1"` and `ThinkingGroup` uses `"th-1"`. Inconsistent format makes parsing harder.

- [ ] A) **Add prefix to all.** `"s-1"`, `"tg-1"`, `"th-1"`. Consistent and parseable.
- [ ] B) **Remove prefix from all.** Just use raw message IDs. Simpler but loses type info in key.
- [ ] C) **Skip / Defer.** Current format works; keys are internal and not user-facing.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 6: useSearchSessions (1 item)

### Q16. Duplicate session IDs across projects — deduplicate or not?

**Context:** Two projects can have sessions with the same ID. `useSearchSessions` returns both. This is correct (they differ by `cwd`), but the duplicate IDs may confuse downstream consumers.

- [ ] A) **Keep current behavior.** Return both; they are distinguishable by `cwd`. This is correct.
- [ ] B) **Deduplicate by ID.** Return only one per ID (e.g., first match). Simpler for consumers.
- [ ] C) **Add composite key.** Return results with a `${cwd}::${sessionId}` composite key for uniqueness.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 7: useGitOperations (4 items)

### Q17. `isGitRepo` should use a discriminated union type

**Context:** Currently `isGitRepo: boolean | null` where `null` means "not yet checked". The type doesn't communicate this semantic. It could also mean "check failed" or "unknown".

- [ ] A) **Use discriminated union.** `{ status: "unchecked" } | { status: "checked"; isRepo: boolean } | { status: "error"; error: Error }`. Most explicit.
- [ ] B) **Use string enum.** `"unchecked" | "yes" | "no" | "error"`. Simpler than object union.
- [ ] C) **Skip / Defer.** `boolean | null` is fine with JSDoc. Changing this affects all consumers.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q18. Per-operation error tracking instead of shared `error` field

**Context:** A single `error: string | null` is shared across all operations. When one operation fails and another succeeds, the success clears the first error. This is confusing.

- [ ] A) **Per-operation errors.** Add `errors: { stage?: string; commit?: string; ... }` object. Keep shared `error` as the latest.
- [ ] B) **Error queue / history.** Store last N errors with operation names. Consumers can filter.
- [ ] C) **Skip / Defer.** Current `clearError()` + shared field is sufficient for the UI.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q19. Consistent error handling: all throw or all silently return

**Context:** `commit()` throws when no active project, but `stageFile()` silently returns `undefined`. This inconsistency makes it hard for callers to know what to expect.

- [ ] A) **All should throw.** Every mutation throws on error. Consistent and explicit.
- [ ] B) **All should silently return + set error.** Every mutation sets `error` state and returns. No throwing.
- [ ] C) **All should return Result types.** `commit()` returns `{ ok: true; hash: string } | { ok: false; error: Error }`. No throwing, no state.
- [ ] D) **Skip / Defer.** The inconsistency is documented and low-impact.
- [ ] E) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q20. `isActiveProject` flag or return null when no project

**Context:** When no project is active, the hook returns default/empty state without indicating it's in a "no project" state. `isGitRepo` is `null`, `status` is empty, but there's no explicit signal.

- [ ] A) **Add `isActiveProject: boolean`.** Simple flag. `false` when `activeProjectPath` is null.
- [ ] B) **Return `null` from the hook entirely.** Hook returns `null` when no project, forcing callers to handle it. Most explicit but biggest refactor.
- [ ] C) **Skip / Defer.** `isGitRepo === null` already serves as the implicit signal.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Module 8: RightSidebar (5 items)

### Q21. Outline panel shows "coming soon" stub instead of real content

**Context:** The Outline panel advertises a feature that doesn't exist yet — it shows "File outline coming soon". The icon rail promotes a feature the app can't deliver.

- [ ] A) **Implement file outline.** Use LSP documentSymbol to show actual file structure. Real feature.
- [ ] B) **Remove the outline panel icon.** Don't advertise what doesn't exist. Remove from `RAIL_ITEMS`.
- [ ] C) **Keep stub but change label.** Rename to "Outline (Beta)" or similar to set expectations.
- [ ] D) **Skip / Defer.** Low priority; the stub is acceptable for now.
- [ ] E) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q22. Edit tool should reconstruct actual file context, not concatenate edits

**Context:** When an edit tool call has multiple edits, the diff view concatenates `oldText`/`newText` fields. This can produce misleading diffs if the edits are at non-adjacent positions in the file.

- [ ] A) **Read actual file and apply edits.** Read the file from disk, apply edits sequentially, then diff. Most accurate but requires IPC call.
- [ ] B) **Show each edit as a separate diff block.** Don't concatenate. Each edit gets its own mini-diff.
- [ ] C) **Skip / Defer.** Current concatenation is "good enough" for common cases.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q23. `setRightSidebarPanel` should require explicit `selectedToolCallId`

**Context:** Currently, when switching to the diff panel, the previous `selectedToolCallId` can "stick" — showing a stale selection. Requiring an explicit ID each time would prevent this.

- [ ] A) **Require `selectedToolCallId` parameter.** Make it mandatory in `setRightSidebarPanel()`. Breaking change but eliminates stale state.
- [ ] B) **Auto-clear on panel switch.** When switching panels, always reset `selectedToolCallId` to `null`. Non-breaking.
- [ ] C) **Skip / Defer.** Sticky selection is a feature, not a bug — users expect to return to their selection.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q24. `registerToolCallClickHandler` should warn if called twice

**Context:** Registering a second click handler silently overwrites the first. This is a bug magnet — if two components register handlers, the first one is lost silently.

- [ ] A) **Warn on duplicate registration.** `console.warn` if a handler is already registered. Still overwrite.
- [ ] B) **Throw on duplicate registration.** Make it loud. Force cleanup of first before registering second.
- [ ] C) **Skip / Defer.** Single-registration is the expected pattern; this won't happen in practice.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

### Q25. `DiffPanel.onSelectEntry` should update store's `selectedToolCallId`

**Context:** Clicking a diff entry calls `onSelectEntry` but it's currently a no-op. The store's `selectedToolCallId` is not updated, so the user gets no visual feedback from their click.

- [ ] A) **Wire it up.** `onSelectEntry` should dispatch `setRightSidebarPanel("diff", entryId)` to the store.
- [ ] B) **Remove the no-op callback.** If the feature isn't ready, don't pass a callback at all. Dead callbacks are misleading.
- [ ] C) **Skip / Defer.** The no-op is a placeholder for future implementation; low priority.
- [ ] D) **Other:** ___________________________________

**Freeform:** ___________________________________

---

## Summary Grid

| # | Module | Decision | Answer |
|---|--------|----------|--------|
| Q1 | usePolling | Per-tick timeout | _____ |
| Q2 | StreamBatcher | dispose flag | _____ |
| Q3 | StreamBatcher | Flush order docs | _____ |
| Q4 | StreamBatcher | hasPending property | _____ |
| Q5 | AgentEventProcessor | Return type / onError | _____ |
| Q6 | AgentEventProcessor | finalize return boolean | _____ |
| Q7 | AgentEventProcessor | sessionId validation | _____ |
| Q8 | AgentEventProcessor | Out-of-order detection | _____ |
| Q9 | AgentEventProcessor | Deterministic ID generator | _____ |
| Q10 | AgentEventProcessor | Unknown event logging | _____ |
| Q11 | IPC Router | sendToRenderer multi-window | _____ |
| Q12 | IPC Router | registerRendererListener | _____ |
| Q13 | Message Grouping | Single vs group for solo items | _____ |
| Q14 | Message Grouping | UIDialog/WorkflowStep types | _____ |
| Q15 | Message Grouping | Key format normalization | _____ |
| Q16 | useSearchSessions | Duplicate session ID handling | _____ |
| Q17 | useGitOperations | isGitRepo discriminated union | _____ |
| Q18 | useGitOperations | Per-operation errors | _____ |
| Q19 | useGitOperations | Consistent error handling | _____ |
| Q20 | useGitOperations | isActiveProject flag | _____ |
| Q21 | RightSidebar | Outline panel stub | _____ |
| Q22 | RightSidebar | Edit tool diff accuracy | _____ |
| Q23 | RightSidebar | Sticky selection bug | _____ |
| Q24 | RightSidebar | Duplicate handler warning | _____ |
| Q25 | RightSidebar | DiffPanel onSelectEntry no-op | _____ |

---

*Fill in your answers above. Once complete, this file serves as the decision record for implementing the remaining 25 TODO items.*
