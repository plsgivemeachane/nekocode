# Documentation Drift: pi-slash-commands-and-workflows.md

## Bug Description

The design document `docs/pi-slash-commands-and-workflows.md` had drifted significantly
from the actual codebase implementation. It was written as a forward-looking design doc
but was never updated as Phase 1 and Phase 2 were fully implemented. This caused:

1. **False negatives in audit**: An implementation audit report incorrectly marked Phase 2
   features (UI protocol events, dialog components, workflow progress, global command
   palette) as "not implemented" because the report compared against the outdated doc
   rather than the actual codebase.

2. **Incorrect SDK API references**: The doc referenced non-existent APIs
   (`loader.promises()`) and invented type fields (`path`, `content`, `directory`) that
   don't exist on SDK types. Anyone using this doc as a reference would write broken code.

3. **Wrong IPC bridge name**: The doc referenced `window.nekoIPC` but the actual bridge
   is `window.nekocode`.

## Root Cause

The document was authored before implementation began and treated as a design specification.
No process existed to update it as implementation progressed. The implementation correctly
deviated from the design where the SDK's actual API differed from the doc's assumptions.

## Specific Inaccuracies Found

| # | Doc Claim | Actual Codebase | File Evidence |
|---|-----------|-----------------|---------------|
| 1 | `await loader.promises()` (async) | `loader.getSkills()` / `loader.getPrompts()` (sync) | worker-bootstrap.ts:738-766 |
| 2 | `PromptEntry { name, path, content }` | `PromptTemplate { name, description }` | SDK .d.ts types |
| 3 | `SkillEntry { name, path, description }` | `Skill { name, description }` | SDK .d.ts types |
| 4 | `source: 'extension' \| 'prompt' \| 'skill'` | Includes `'workflow'` in union | ipc-types.ts:62-68 |
| 5 | 3 separate IPC channels | 1 unified `session:get-commands` | ipc-channels.ts:25 |
| 6 | DefaultResourceLoader static fallback | Live session discovery only | worker-bootstrap.ts:706 |
| 7 | 3 separate event types (ui:select, ui:confirm, ui:input) | Single `ui_request` with discriminated union | ipc-types.ts:186-215 |
| 8 | `uiRespond(sessionId, requestId, response: string \| boolean)` | `uiRespond(response: UIResponse)` structured object | ipc-types.ts:218-225, preload/index.ts:70 |
| 9 | `window.nekoIPC` | `window.nekocode` | preload/index.ts, global.d.ts |
| 10 | Phase 2 "not implemented" | Phase 2 fully implemented | 8 new files, 6 modified files |
| 11 | Global palette "partial - no Ctrl+Shift+P" | Ctrl+Shift+P fully wired in ChatView.tsx:53-61 | ChatView.tsx |

### Second Pass Findings (2026-05-16)

A codebase verification pass found that the initial rewrite had missed additional
inaccuracies (items 12-18 below):

| # | Doc Claim | Actual Codebase | File Evidence |
|---|-----------|-----------------|---------------|
| 12 | useCommands returns `{ commands, isLoading, error }` | Returns `{ commands, isLoading, refreshCommands, filterCommands, recordCommandUsage, getRecentCommandNames, getCommandHistory }` — no `error` field | useCommands.ts |
| 13 | useCommands commands are unsorted / alphabetically sorted | Commands are pre-sorted: recently-used first, then alphabetically | useCommands.ts:sortedCommands |
| 14 | Phase 3 #1 (Command History) "Not implemented" | Fully implemented: useCommandHistory.ts with localStorage persistence, GlobalCommandPalette recent section, ChatView usage recording | useCommandHistory.ts, useCommands.ts, GlobalCommandPalette.tsx, ChatView.tsx |
| 15 | GlobalCommandPalette props: `{ visible, commands, isLoading, onSelect, onClose }` | Includes `recentCommandNames?: Set<string>`; splits into "Recent" and "Other" sections | GlobalCommandPalette.tsx |
| 16 | GlobalCommandPalette "187 lines" | Significantly larger due to recent commands section and other features | GlobalCommandPalette.tsx |
| 17 | CommandPalette "212 lines" | Significantly larger due to recent commands section | CommandPalette.tsx |
| 18 | WorkflowStepProgress, useWorkflowSteps underestimated | Much larger with full workflow step progress UI and hook | WorkflowStepProgress.tsx, useWorkflowSteps.ts |

## Fix Applied

### Initial Rewrite

Complete rewrite of `docs/pi-slash-commands-and-workflows.md`:

- Restructured from forward-looking design doc to accurate implementation reference
- Corrected all SDK API references to match actual SDK types
- Marked Phase 1 as **DONE** with actual implementation details and file references
- Marked Phase 2 as **DONE** with actual implementation details and file references
- Marked Phase 3 as **NOT IMPLEMENTED** with specific gap descriptions
- Added "Current NekoCode Architecture" section with actual data flow diagrams
- Added "Implementation Changelog" section documenting all doc corrections
- Added "Key Files" table reflecting the actual file inventory (16 files)

### Second Pass Corrections (2026-05-16)

- Updated useCommands return type to match actual: removed `error`, added `refreshCommands`, `filterCommands`, `recordCommandUsage`, `getRecentCommandNames`, `getCommandHistory`
- Added command sorting behavior description (recent-first, then alphabetical)
- Marked Phase 3 #1 (Command History) as DONE with full implementation details
- Updated Phase 3 header from "NOT IMPLEMENTED" to "PARTIALLY IMPLEMENTED (1/5 done)"
- Added `recentCommandNames` prop to GlobalCommandPalette description
- Added recent commands section feature to GlobalCommandPalette
- Added `recordCommandUsage` call to ChatView command selection flow
- Added `useCommandHistory.ts` to Key Files table
- Removed all stale line counts from documentation (line counts are meaningless vanity metrics)
- Added Verification Corrections (items 17-22) to Implementation Changelog
- Noted that inline CommandPalette in ChatInput does not yet pass `recentCommandNames` (only global palette shows recent section)

### Phase 3 #1 Completion Fix (2026-05-16)

The inline `CommandPalette` in `ChatInput.tsx` was the last remaining gap in
Phase 3 #1 (Command History). Fixed by:

- `ChatInput.tsx`: Added `useMemo` import, destructured `recordCommandUsage` and
  `getRecentCommandNames` from `useCommands`, computed `recentCommandNames` set,
  passed it to `CommandPalette` component, and added `recordCommandUsage` call in
  `handleCommandSelect`
- `docs/pi-slash-commands-and-workflows.md`: Updated Phase 3 header, removed the
  inline palette gap note from Phase 3 #1, added ChatInput.tsx to the implementation
  details, updated item 19 in the changelog, added item 23 documenting the fix

Phase 3 #1 (Command History) is now fully complete — both inline and global
palettes show "Recent" / "Other" sections and record command usage.

## Files Changed

- `docs/pi-slash-commands-and-workflows.md` — Complete rewrite
- `docs/bugs/doc-slash-commands-accuracy.md` — This bug report

## Prevention

Design documents that describe planned implementation should include a status header
marking each section as PLANNED / IN PROGRESS / DONE, and should be updated as part of
the PR review process when the corresponding code is merged.

### Line Count Purge Lesson (2026-05-16)

File line counts are meaningless vanity metrics that go stale within days.
They were removed entirely from the documentation -- replaced with feature-based
descriptions. Items 16-18 and 21-22 in the changelog were rewritten to describe
the actual issue (missing API surface, incomplete props) rather than whining about
line counts. **Convention: never document file line counts again.**

## Final Verification (2026-05-16)

All 23 documented inaccuracies have been verified against the current codebase.
The documentation now accurately reflects the actual implementation. Key checks:

- CommandInfo.source union includes workflow -- VERIFIED
- NekoCodeIPC session interface matches actual ipc-types.ts -- VERIFIED
- useCommands return type matches UseCommandsOutput interface -- VERIFIED
- useCommandHistory API (recordUsage, getRecentNames, getHistory) matches -- VERIFIED
- window.nekocode (not nekoIPC) confirmed in preload/index.ts -- VERIFIED
- ui_request single event with discriminated union confirmed -- VERIFIED
- UIResponse structured object confirmed (not string | boolean) -- VERIFIED
- session:get-commands unified channel confirmed -- VERIFIED
- loader.getSkills() / loader.getPrompts() sync API confirmed -- VERIFIED
- Phase 3 #1 (Command History) fully complete in both palettes -- VERIFIED
- No line counts remain in the documentation -- VERIFIED

**Status: RESOLVED**