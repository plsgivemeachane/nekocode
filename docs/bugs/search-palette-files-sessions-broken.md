# Search Palette: Files and Sessions Not Working

## Bug Description

The search palette (Ctrl+P / Ctrl+Shift+P / NavBar button) only showed command results. File and session search results were completely invisible, even when the user typed a search query.

## Root Causes

There were **three** distinct issues causing this bug:

### 1. cmdk `filter={() => 1}` vs `shouldFilter={false}` (Critical)

The SearchPalette used `filter={() => 1}` to bypass cmdk's built-in search filtering. While this technically makes all items "pass" the filter, it has a critical side effect: **cmdk still runs its internal DOM sorting/manipulation logic** (`X()` function) when `shouldFilter` is not explicitly `false`.

When cmdk's `X()` function runs, it reorders DOM nodes by calling `appendChild()` on group containers. This directly conflicts with React's virtual DOM reconciliation. When new items (like file/session results) are added to the DOM by React after an async search completes, cmdk's DOM manipulation can cause them to be misplaced, duplicated, or rendered invisible — even though their filter score is 1 (pass).

**Fix**: Changed from `filter={() => 1}` to `shouldFilter={false}`. This completely disables cmdk's internal filtering AND sorting, preventing any DOM manipulation conflicts with React.

### 2. `useSearchFiles` returned empty for empty queries (UX Bug)

When the user opened the search palette (especially with Ctrl+P for files mode), the query was empty. The `useSearchFiles` hook short-circuited and returned `[]` for empty queries:

```typescript
if (!projectPath || !query.trim()) {
  setResults([])
  setIsLoading(false)
  return
}
```

This meant that even though the backend `searchFiles()` function supports returning all files (up to the limit) when the query is empty, the hook never called it. The user would see only commands (which show all when query is empty) but no files.

**Fix**: Changed the hook to call the search function even with an empty query, allowing the backend to return the full file list (up to the configured limit of 50 files).

### 3. `useSearchSessions` returned empty for empty queries (UX Bug)

Same issue as files — the session search hook returned `[]` when the query was empty:

```typescript
if (!query.trim()) return []
```

When the user opened the palette, no sessions were shown even though sessions exist in the project store.

**Fix**: Changed the hook to return all sessions (with a neutral score of 0.5) when the query is empty, so they appear as suggestions immediately.

### 4. `DialogHeader` placed outside `DialogContent` (Accessibility)

The `CommandDialog` component placed `<DialogHeader>` as a sibling of `<DialogContent>`, but Radix Dialog only renders content inside `DialogContent` in the portal. The accessible title and description were rendered in the main DOM tree (behind the overlay), making them invisible to screen readers.

**Fix**: Moved `<DialogHeader>` inside `<DialogContent>`.

## Files Changed

1. `src/renderer/src/components/ui/command.tsx`
   - Added `shouldFilter` prop to `CommandDialog`
   - Moved `DialogHeader` inside `DialogContent` for proper accessibility
   - Both `filter` and `shouldFilter` are now passed to the underlying `Command` component

2. `src/renderer/src/components/chat/SearchPalette.tsx`
   - Changed `filter={() => 1}` to `shouldFilter={false}`
   - Updated comments to explain the reasoning

3. `src/renderer/src/hooks/useSearchFiles.ts`
   - Removed the `!query.trim()` short-circuit that prevented empty-query searches
   - Empty queries now trigger a debounced search that returns all files (up to limit)

4. `src/renderer/src/hooks/useSearchSessions.ts`
   - Removed the `!query.trim()` early return
   - Empty queries now return all sessions with a neutral score
   - Score-based filtering only applies when query is non-empty

## Testing

- Type-check: ✅ Passes
- Lint: ✅ Passes
- Unit tests: ✅ All 730+ tests pass
