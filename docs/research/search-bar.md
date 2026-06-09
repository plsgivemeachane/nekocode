# NekoCode Search Bar — Research & Design Document

> **Date:** 2026-06-09  
> **Status:** Research Complete — Ready for Implementation Proposal  
> **Author:** Pi Agent (Firecrawl-assisted research)

---

## 1. Executive Summary

NekoCode needs a **unified search bar** — a single entry point that allows users to search across files, commands, sessions, and settings within the app. This document captures the results of online research (via Firecrawl) for suitable libraries, patterns, and architectures, specifically tailored to NekoCode's stack (Electron + React + TypeScript + Tailwind + Radix UI + cmdk).

**Key Finding:** NekoCode already has `cmdk` (v1.1.1) as a dependency and already uses it in `GlobalCommandPalette` (Ctrl+Shift+P) and `CommandPalette` (slash commands in chat). The search bar should **extend** this existing infrastructure rather than introduce a new library.

---

## 2. Research Methodology

Online research was conducted via Firecrawl web search and scrape, covering:

| Search Query | Sources Found | Key Findings |
|---|---|---|
| "search bar component React TypeScript Tailwind Radix UI Electron desktop app" | 8 results | cmdk, shadcn Command, Radix Dialog patterns dominate |
| "cmdk command palette React component search bar keyboard shortcut Electron" | 10 results | cmdk is the de facto standard; shadcn/ui wraps it beautifully |
| "kbar react command palette vs cmdk comparison search component" | 8 results | cmdk won the ecosystem; kbar is less maintained |
| "VS Code search implementation electron search bar file search command palette architecture" | 8 results | VS Code uses a multi-mode search: Files, Commands, Settings, Symbols |
| "react search bar desktop app IDE file search fuzzy search fuse.js" | 8 results | Fuse.js is the standard for client-side fuzzy search |
| "cmdk npm package shadcn command dialog search input" | Scraped results | cmdk supports grouping, filtering, custom rendering |

---

## 3. Library Comparison

### 3.1 cmdk (✅ RECOMMENDED — Already Installed)

| Attribute | Details |
|---|---|
| **Package** | `cmdk` v1.1.1 (already in `package.json`) |
| **Author** | Paco Coursey (dip) — shadcn/ui contributor |
| **GitHub** | https://github.com/dip/cmdk |
| **Stars** | 10k+ |
| **Approach** | Fast, unstyled command menu React component |
| **Features** | Keyboard navigation, fuzzy search, grouping, nested items, async loading, accessible (WAI-ARIA), composable API |
| **Integration** | Already integrated via `src/renderer/src/components/ui/command.tsx` (shadcn wrapper) |
| **Tailwind** | Fully compatible — unstyled, accepts className props |
| **Bundle Size** | ~5KB gzipped |
| **Maintenance** | Actively maintained, used by Vercel, shadcn/ui default |

**Why cmdk is perfect for NekoCode:**
- Already a dependency and in use
- Composable: `<Command>`, `<CommandInput>`, `<CommandList>`, `<CommandGroup>`, `<CommandItem>` — fits naturally into a multi-mode search
- Built-in keyboard navigation (arrow keys, enter, escape)
- Built-in fuzzy search filter
- Renders as a dialog (modal) — exactly what VS Code, Linear, and other desktop apps use
- Zero additional dependencies

### 3.2 kbar (❌ NOT RECOMMENDED)

| Attribute | Details |
|---|---|
| **Package** | `kbar` |
| **Approach** | Full-featured command palette with action model |
| **Pros** | Nice action abstraction, nested actions, animations built-in |
| **Cons** | Less actively maintained than cmdk, larger bundle, NekoCode already uses cmdk |
| **Verdict** | Adding kbar alongside cmdk creates bloat and inconsistency |

### 3.3 Custom Implementation (❌ NOT RECOMMENDED)

| Attribute | Details |
|---|---|
| **Approach** | Build from scratch with Radix Dialog + custom input + Fuse.js |
| **Pros** | Full control |
| **Cons** | Reimplements what cmdk already provides (keyboard nav, fuzzy search, accessibility); significant dev time |
| **Verdict** | cmdk already provides 90% of what's needed |

### 3.4 Fuse.js (⚠️ SUPPLEMENTARY — For Advanced File Search)

| Attribute | Details |
|---|---|
| **Package** | `fuse.js` |
| **Approach** | Lightweight fuzzy-search library (zero deps) |
| **Features** | Tokenized search, extended search operators, weighting, threshold tuning |
| **Use Case** | If cmdk's built-in filter isn't sufficient for file content search, Fuse.js can power the file indexing/search layer |
| **Bundle Size** | ~5KB gzipped |
| **Verdict** | Consider as an add-on only if advanced file search is needed beyond what cmdk provides |

---

## 4. Existing NekoCode Infrastructure

### 4.1 Already Built — cmdk Integration

NekoCode already has a full cmdk setup:

| Component | Path | Purpose |
|---|---|---|
| **UI Primitives** | `src/renderer/src/components/ui/command.tsx` | shadcn/ui wrapper around cmdk: `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator` |
| **Global Command Palette** | `src/renderer/src/components/chat/GlobalCommandPalette.tsx` | Modal palette (Ctrl+Shift+P / Ctrl+K) for slash commands |
| **Inline Command Palette** | `src/renderer/src/components/chat/CommandPalette.tsx` | Inline slash-command autocomplete in chat input |
| **Commands Hook** | `src/renderer/src/hooks/useCommands.ts` | Fetches commands, manages loading state, provides search filtering |
| **Command History Hook** | `src/renderer/src/hooks/useCommandHistory.ts` | Tracks recently used commands with localStorage persistence |

### 4.2 Integration Points for Search Bar

| Area | Current State | Search Bar Integration |
|---|---|---|
| **NavBar** | Logo + project actions + zoom + window controls | Add search trigger button (magnifying glass icon) that opens the search palette |
| **GlobalCommandPalette** | Shows only slash commands | Extend to support **modes**: Commands, Files, Sessions, Settings |
| **ChatView** | Renders GlobalCommandPalette | Continue hosting the search palette, but with multi-mode support |
| **Project Store** | No search-related state | Add `searchMode` state and search results to the store |
| **IPC** | No file-search IPC channel | Add `search:files` and `search:sessions` IPC channels in main process |
| **Main Process** | ProjectManager, SessionManager | Add file indexing and search functionality |

### 4.3 Keyboard Shortcuts

| Shortcut | Current Action | Proposed Action |
|---|---|---|
| `Ctrl+Shift+P` | Opens command palette | Opens search palette in **Commands** mode |
| `Ctrl+P` | No binding | Opens search palette in **Files** mode (VS Code convention) |
| `Ctrl+K` | Opens command palette | Opens search palette in **Commands** mode (keep as alias) |
| `Ctrl+Shift+S` | No binding | Opens search palette in **Sessions** mode |

---

## 5. Proposed Architecture

### 5.1 Multi-Mode Search Palette

Rather than a simple search bar, NekoCode should adopt the **VS Code-style multi-mode search palette** — a single modal dialog with mode tabs/filters:

```
┌─────────────────────────────────────────────────────┐
│ 🔍  [Commands] [Files] [Sessions]     ⌘K ▸ type... │
├─────────────────────────────────────────────────────┤
│ > recent-command-1          [extension]             │
│   recent-command-2          [builtin]               │
│ ─────────────────────────────────────────────────── │
│   other-command-1           [skill]                 │
│   other-command-2           [prompt]                │
└─────────────────────────────────────────────────────┘
```

**Mode switching:**
- Prefix `>` → Commands mode (like VS Code)
- No prefix → Files mode (default, like VS Code's Ctrl+P)
- Prefix `@` → Sessions mode
- Prefix `:` → Settings mode

### 5.2 Component Architecture

```
SearchPalette (new)
├── SearchPalette.tsx          — Main modal container using CommandDialog
├── SearchPaletteInput.tsx     — Input with mode detection (>, @, :)
├── SearchPaletteResults.tsx   — Results list with grouped sections
├── useSearchFiles.ts          — Hook for file search via IPC
├── useSearchSessions.ts       — Hook for session search
└── useSearchMode.ts           — Hook for mode detection and switching
```

### 5.3 Data Flow

```
User types in SearchPaletteInput
  │
  ├── Detects mode prefix (>, @, :, or none)
  │
  ├── Mode: Commands → filters via useCommands (existing)
  │
  ├── Mode: Files → IPC → main/search-files → returns file paths
  │
  ├── Mode: Sessions → filters via project-store sessions
  │   └── Mode: Settings → filters from SettingsView options
  │
  └── Results rendered in SearchPaletteResults
```

### 5.4 Main Process — File Search

A new IPC channel `search:files` will be added:

```typescript
// shared/ipc-types.ts
interface SearchFilesRequest {
  projectPath: string
  query: string
  /** Maximum number of results */  limit?: number
  /** File extensions to include (e.g., [".ts", ".tsx"]) */  extensions?: string[]
  /** Directories to exclude (e.g., ["node_modules", ".git"]) */
  excludeDirs?: string[]
}

interface SearchFilesResult {
  files: SearchResultEntry[]
}

interface SearchResultEntry {
  /** Relative path from project root */
  relativePath: string
  /** Absolute path */
  absolutePath: string
  /** File name only */
  fileName: string
  /** Match score (0-1, higher = better match) */
  score: number
}
```

Implementation in main process:
- Use Node.js `fs.readdir` with recursive walk
- Apply fuzzy matching (simple implementation or optional Fuse.js)
- Cache file index per project (invalidate on file changes via `fs.watch`)
- Default exclusions: `node_modules`, `.git`, `dist`, `build`, `.next`

---

## 6. Implementation Tasks

### Phase 1: Core Search Palette (Commands + Files)

| # | Task | Estimated Effort |
|---|---|---|
| 1 | Create `SearchPalette.tsx` component — extends `CommandDialog` with mode tabs | 2h |
| 2 | Create `useSearchMode.ts` hook — detects mode from input prefix | 1h |
| 3 | Refactor `GlobalCommandPalette.tsx` to use the new `SearchPalette` as its base | 2h |
| 4 | Add `search:files` IPC channel + types in `ipc-types.ts` | 1h |
| 5 | Implement file search in main process (`search-files.ts`) | 2h |
| 6 | Create `useSearchFiles.ts` hook — calls IPC and returns results | 1h |
| 7 | Add search trigger button to `NavBar.tsx` (magnifying glass icon) | 30min |
| 8 | Bind `Ctrl+P` to open search in Files mode | 30min |
| 9 | Write unit tests for `useSearchMode` and `useSearchFiles` | 1h |

### Phase 2: Sessions + Settings Search

| # | Task | Estimated Effort |
|---|---|---|
| 10 | Create `useSearchSessions.ts` hook — searches session names and first messages | 1h |
| 11 | Add Sessions mode (`@` prefix) to SearchPalette | 1h |
| 12 | Add Settings mode (`:` prefix) to SearchPalette | 1h |
| 13 | Bind `Ctrl+Shift+S` for Sessions mode | 15min |

### Phase 3: Polish & Performance

| # | Task | Estimated Effort |
|---|---|---|
| 14 | Add file index caching with invalidation | 2h |
| 15 | Add keyboard shortcut hints in mode tabs | 30min |
| 16 | Add recent files tracking (persisted in localStorage) | 1h |
| 17 | Debounce file search for large projects | 30min |
| 18 | Add empty states per mode with helpful messages | 30min |

---

## 7. Design Mockup (Tailwind Classes)

The search palette should match NekoCode's existing dark theme:

```
bg-surface-900/95     — Palette background (semi-transparent)
border-surface-700/70 — Border
backdrop-blur-md       — Blur backdrop

text-text-primary     — Input text
text-text-secondary   — Result items
text-text-muted       — Group headings, descriptions

bg-accent-400/10      — Selected item highlight
text-accent           — Active mode tab

bg-purple-500/20 text-purple-400 — Extension badge
bg-blue-500/20 text-blue-400     — Skill badge
bg-green-500/20 text-green-400   — Prompt badge
bg-yellow-500/20 text-yellow-400 — Builtin badge
```

Mode tabs styling:
```tsx
<button className={cn(
  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
  isActive
    ? "bg-accent-400/10 text-accent"
    : "text-text-muted hover:text-text-secondary hover:bg-surface-800/50"
)}>
```

---

## 8. Comparison with Similar Apps

| App | Search Pattern | Library | Notes |
|---|---|---|---|
| **VS Code** | Multi-mode palette (Ctrl+P files, Ctrl+Shift+P commands) | Custom | Gold standard for IDE search; prefix-based mode switching |
| **Linear** | Command palette (Cmd+K) | cmdk | NekoCode's closest analog; cmdk was built for this |
| **Raycast** | Multi-mode with extensions | Custom | Shows that extensibility matters |
| **Zed** | Multi-mode palette | Custom (Rust) | Very fast fuzzy matching with Zed-specific engine |
| **Cursor** | VS Code fork | Inherits VS Code | Shows prefix-based mode switching works at scale |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| File search slow on large projects | Implement caching + debounce; limit results; async with cancellation |
| Too many modes overwhelm users | Start with Commands + Files only; add Sessions/Settings later |
| Breaking existing GlobalCommandPalette | Refactor carefully; existing functionality preserved as Commands mode |
| File watcher overhead | Use debounced invalidation; only watch active project |
| Accessibility | cmdk provides WAI-ARIA out of the box; test with keyboard-only navigation |

---

## 10. Conclusion

**Recommendation: Extend the existing cmdk-based GlobalCommandPalette into a multi-mode SearchPalette.**

No new libraries are needed. The `cmdk` package already installed in NekoCode provides all the building blocks. The implementation should:

1. **Keep the existing command palette** as "Commands" mode (prefix `>`)
2. **Add "Files" mode** as the default mode (no prefix, like VS Code's Ctrl+P)
3. **Add "Sessions" and "Settings" modes** as progressive enhancements
4. **Add a search trigger** in the NavBar for discoverability
5. **Implement file search** as a new IPC channel in the main process

This approach:
- Leverages existing code and patterns (no new deps)
- Follows VS Code conventions users already know
- Is incremental (Phase 1 delivers core value)
- Maintains the quality bar set by the existing GlobalCommandPalette
