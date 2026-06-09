# Search Bar Feature Implementation

> **Date:** 2026-06-09  
> **Type:** Feature Implementation  
> **Status:** Complete  

## Summary

Implemented a multi-mode search bar (SearchPalette) for NekoCode that replaces the previous GlobalCommandPalette with a unified search interface supporting four modes:

- **All** (no prefix) — Search commands, files, and sessions simultaneously
- **Commands** (`>` prefix) — Slash commands only
- **Files** (`@` prefix) — File search across the project directory
- **Sessions** (`:` prefix) — Session search across all projects

## Files Created

| File | Purpose |
|---|---|
| `src/main/search-files.ts` | Main-process file search engine with fuzzy matching |
| `src/renderer/src/hooks/useSearchMode.ts` | Hook to detect search mode from input prefix |
| `src/renderer/src/hooks/useSearchFiles.ts` | Hook for debounced file search via IPC |
| `src/renderer/src/hooks/useSearchSessions.ts` | Hook for client-side session search |
| `src/renderer/src/components/chat/SearchPalette.tsx` | Multi-mode search dialog component |

## Files Modified

| File | Change |
|---|---|
| `src/shared/ipc-types.ts` | Added `SearchFilesRequest`, `SearchResultEntry`, `SearchFilesResult` types and `search` namespace to `NekoCodeIPC` |
| `src/shared/ipc-channels.ts` | Added `SEARCH_FILES` channel constant |
| `src/main/ipc-handlers.ts` | Added `search:files` IPC handler using `searchFiles()` |
| `src/preload/index.ts` | Added `search.files()` IPC bridge |
| `src/renderer/src/components/chat/ChatView.tsx` | Replaced `GlobalCommandPalette` with `SearchPalette`, added `Ctrl+P` shortcut for files mode, added `nekocode:open-search` event listener |
| `src/renderer/src/components/layout/NavBar.tsx` | Added Search button that dispatches `nekocode:open-search` event |
| `src/tests/__utils__/test-utils.tsx` | Added `search` mock to `createMockIPC()` |

## Architecture Decisions

### 1. No External Fuzzy Search Library

Instead of adding Fuse.js as a dependency, I implemented a lightweight fuzzy scorer directly in `search-files.ts`. The algorithm:
- Gives highest scores to exact substring matches
- Provides boundary bonuses (start of string, after path separators, camelCase transitions)
- Awards consecutive match bonuses
- Scores file names more heavily than full paths

This avoids adding a dependency and keeps the search fast for typical project sizes.

### 2. Mode Detection via Input Prefix

The `useSearchMode` hook detects the mode by checking the first non-whitespace character:
- `>` → commands
- `@` → files
- `:` → sessions
- No prefix → all

The prefix is stripped before the query is passed to downstream search hooks. Mode tabs in the UI allow explicit mode switching and will pre-populate the input with the appropriate prefix.

### 3. Event-Based NavBar → ChatView Communication

The NavBar Search button dispatches a `nekocode:open-search` CustomEvent. ChatView listens for this event and opens the SearchPalette. This avoids tight coupling between the NavBar and ChatView components.

### 4. SearchPalette Replaces GlobalCommandPalette

The `SearchPalette` component is a superset of `GlobalCommandPalette` — it provides all the same command functionality plus file and session search. The old `GlobalCommandPalette` component is no longer imported in ChatView (but the file still exists for backward compatibility).

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Open SearchPalette in Commands mode |
| `Ctrl+P` | Open SearchPalette in Files mode |
| Search button (NavBar) | Open SearchPalette in All mode |

## Search Bar UI

- Mode tabs at the top: All | Commands | Files | Sessions
- Prefix hints shown as keyboard badges on each tab
- Results grouped into sections: Recent Commands, All Commands, Files, Sessions
- Source badges on commands (extension, skill, prompt, builtin)
- File results show file name + relative path
- Session results show name + project path

## Testing

All existing tests pass. The test mock was updated to include the `search` IPC namespace.
