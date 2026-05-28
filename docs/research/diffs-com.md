# @pierre/diffs — Diff & Code Rendering Library

> **Research Document** — Comprehensive analysis of [diffs.com](https://diffs.com/) for NekoCode integration planning.

## Overview

`@pierre/diffs` is an open-source diff and code rendering library by [The Pierre Computer Company](https://pierre.computer/). Built on [Shiki](https://shiki.style/) for syntax highlighting and theming, it is super customizable and comes packed with features. Currently at **v1.2.3**.

- **Website:** https://diffs.com/
- **Docs:** https://diffs.com/docs
- **Theme page:** https://diffs.com/theme
- **Playground:** https://diffs.com/playground
- **Package:** `@pierre/diffs` (npm)
- **Install:** `bun add @pierre/diffs`
- **Made by:** The Pierre Computer Company (team with 150+ years combined experience from Cloudflare, Coinbase, Discord, GitHub, Reddit, Stripe, X)

---

## Why This Matters for NekoCode

NekoCode's chat interface renders AI responses with code blocks, and the app needs diff visualization for file changes suggested by the AI. `@pierre/diffs` provides:

1. **Split & unified diff layouts** — Side-by-side or stacked views via CSS Grid and Shadow DOM
2. **Shiki-based syntax highlighting** — Supports any Shiki theme with automatic dark/light mode
3. **Merge conflict resolution UI** — Built-in accept current/incoming/both controls
4. **Comments & annotations** — Line-level comments, CI annotations, code review UI
5. **Accept/Reject changes** — Interactive code review with undo/keep buttons (AI-assisted coding patterns)
6. **Line selection** — Click-to-select, drag-to-range, programmatic selection
7. **Token hover** — Attach callbacks to individual syntax tokens for tooltips/LSP integration
8. **Custom hunk separators** — Multiple built-in styles plus CSS-only custom variants
9. **Inline change highlighting** — Word-alt, word, or character-level granularity
10. **Worker pool** — Offload syntax highlighting to background threads
11. **SSR support** — Server-side rendering with hydration
12. **Diff arbitrary files** — Compare any two files, not just Git patches

---

## Core Architecture

### HTML-First Philosophy

The library has an opinionated architectural stance: **browsers are efficient at rendering raw HTML**. Lower-level APIs purely render strings (raw HTML), which are consumed by higher-order components and utilities. This gives great performance and flexibility.

- **Low-level APIs** → render raw HTML strings
- **High-level components** → consume strings, render into Shadow DOM + CSS Grid

### Package Exports

| Package | Description |
|---|---|
| `@pierre/diffs` | Vanilla JS components + utility functions |
| `@pierre/diffs/react` | React components with full interactivity |
| `@pierre/diffs/ssr` | Server-side rendering utilities |
| `@pierre/diffs/worker` | Worker pool for offloading syntax highlighting |

### Shadow DOM + CSS Grid

All higher-order components render into Shadow DOM and use CSS Grid layout. This means:
- Fewer DOM nodes → faster rendering
- Style isolation → no CSS conflicts with host app
- Grid layout → precise column alignment in split view

---

## Key Features

### 1. Diff Layout Styles

Choose from stacked (unified) or split (side-by-side). Both use CSS Grid and Shadow DOM under the hood.

```typescript
// React
<MultiFileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{ diffStyle: 'split' }} // or 'unified'
/>
```

### 2. Shiki Theme Integration

Built on top of Shiki for syntax highlighting. Components automatically adapt to your theme selection, including across color modes.

```typescript
options={{
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'system', // 'system' | 'dark' | 'light'
}}
```

Supports any Shiki theme. Built-in Pierre themes (`pierre-dark`, `pierre-light`) are bundled.

### 3. Change Styling Options

Multiple ways to visualize changes:

- **`diffIndicators`**: `'bars'` (default, colored bars on left edge) | `'classic'` (+/– characters) | `'none'`
- **`disableBackground`**: Toggle colored backgrounds on changed lines
- **`lineDiffType`**: `'word-alt'` (default) | `'word'` | `'char'` | `'none'` — inline change highlighting granularity
- **`overflow`**: `'scroll'` (default) | `'wrap'` — long line handling
- **`disableLineNumbers`**: Show/hide line numbers

### 4. Custom Hunk Separators

Built-in separator styles:
- `'line-info'` (default) — Collapsed line count, clickable to expand
- `'line-info-basic'` — More compact full-width variant
- `'metadata'` — Patch format like `@@ -60,6 +60,22 @@`
- `'simple'` — Subtle bar separator

Plus CSS-only custom separators.

Related options:
- `expandUnchanged` — Force all context to render
- `expansionLineCount` — Lines revealed per expand click (default: 100)
- `collapsedContextThreshold` — Auto-expand below this size (default: 1)

### 5. Merge Conflict Resolution UI

Dedicated `UnresolvedFile` component renders merge conflicts with structured accept/reject controls:
- Accept current change
- Accept incoming change
- Accept both changes
- Instant preview of resolved file

```typescript
import { UnresolvedFile } from '@pierre/diffs/react';

<UnresolvedFile file={conflictFile} options={{ theme: 'pierre-dark' }} />
```

Currently in beta/experimental and may change.

### 6. Comments & Annotations

Flexible annotation framework for injecting additional content:
- Line comments (user-authored)
- CI job annotations
- Third-party content injection
- Code review UI

Annotations can be used to build interactive code review interfaces similar to AI-assisted coding tools like Cursor — tracking accept/reject state per change.

### 7. Accept/Reject Changes (AI Code Review Pattern)

Build interactive code review UIs where each change can be accepted or rejected:

- Track state of each change
- Inject custom UI like accept/reject buttons
- Provide immediate visual feedback
- Undo/Keep keyboard shortcuts

This is especially relevant for NekoCode's AI-assisted coding workflow where the AI suggests file changes.

### 8. Line Selection

Enable with `enableLineSelection: true`:
- Click a line number to select
- Click and drag for multi-line selection
- Shift+click to extend selection
- Programmatic selection control
- Selections handle differences between split and unified views

### 9. Token Hover

Attach hover callbacks to individual syntax tokens with `onTokenEnter` and `onTokenLeave`. Useful for:
- LSP `textDocument/hover` tooltips
- CSS knowledge tooltips
- Token-aware styling
- Custom hover UI

```typescript
options={{
  onTokenEnter: ({ tokenText, lineNumber, lineCharStart, lineCharEnd, side, tokenElement }) => {
    // Show tooltip or hover styling
  },
  onTokenLeave: ({ tokenText, side, tokenElement }) => {
    // Clean up hover UI
  },
}}
```

### 10. Diff Arbitrary Files

Pass any two files and get a diff between them — not limited to Git patches. Especially useful for comparing across generative snapshots where linear history isn't available.

### 11. Custom Headers

Switch between lightweight header metadata and fully custom headers:
- `renderHeaderPrefix` — Custom UI before filename/icons
- `renderHeaderMetadata` — Custom UI after diff stats
- `renderCustomHeader` — Replace entire built-in header

---

## Core Types

### FileContents

Represents a single file for rendering or diffing:

```typescript
interface FileContents {
  name: string;           // Filename (display + language detection)
  contents: string;       // File text content
  lang?: SupportedLanguages; // Override detected language
  cacheKey?: string;      // AST caching key for Worker Pool
}
```

### FileDiffMetadata

Represents the differences between two files:

```typescript
interface FileDiffMetadata {
  name: string;                    // Current filename
  prevName: string | undefined;    // Previous filename (for renames)
  lang?: SupportedLanguages;       // Override language
  type: ChangeTypes;               // 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted'
  hunks: Hunk[];                   // Array of diff hunks
  splitLineCount: number;          // Line count for split view
  unifiedLineCount: number;        // Line count for unified view
  oldLines?: string[];             // Full old file (enables expansion)
  newLines?: string[];             // Full new file (enables expansion)
  cacheKey?: string;               // AST caching key
}
```

### Hunk

```typescript
interface Hunk {
  additionCount: number;
  additionStart: number;
  additionLines: number;
  deletionCount: number;
  deletionStart: number;
  deletionLines: number;
  hunkContent: (ContextContent | ChangeContent)[];
  hunkContext: string | undefined;
  // Internal rendering position info
  splitLineStart: number;
  splitLineCount: number;
  unifiedLineStart: number;
  unifiedLineCount: number;
}
```

---

## Creating Diffs

### From Two Files

```typescript
import { parseDiffFromFile, type FileContents, type FileDiffMetadata } from '@pierre/diffs';

const oldFile: FileContents = {
  name: 'greeting.ts',
  contents: 'export const greeting = "Hello";',
  cacheKey: 'greeting-old',
};

const newFile: FileContents = {
  name: 'greeting.ts',
  contents: 'export const greeting = "Hello, World!";',
  cacheKey: 'greeting-new',
};

const diff: FileDiffMetadata = parseDiffFromFile(oldFile, newFile);
// Includes oldLines/newLines for "expand unchanged" feature
```

### From a Patch String

```typescript
import { parsePatchFiles, type ParsedPatch } from '@pierre/diffs';

const patchString = `--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n const x = 1;\n-const y = 2;\n+const y = 3;\n const z = 4;`;

const patches: ParsedPatch[] = parsePatchFiles(patchString, 'my-patch-key');
const files: FileDiffMetadata[] = patches[0].files;
// Note: No oldLines/newLines, so "expand unchanged" won't work
```

---

## React API

Import from `@pierre/diffs/react`.

### Components

| Component | Purpose |
|---|---|
| `CodeView` | Mixed, virtualized list of files and diffs in one scroll container |
| `MultiFileDiff` | Compare two file versions |
| `PatchDiff` | Render from a patch string |
| `FileDiff` | Render a pre-parsed `FileDiffMetadata` |
| `File` | Render a single code file without diff |
| `UnresolvedFile` | Merge conflict markers with resolution UI (beta) |

### CodeView (Most Important for NekoCode)

`CodeView` renders a mixed, virtualized list of files and diffs inside one scroll container — exactly what a code review or AI chat with file changes needs.

```typescript
import { parseDiffFromFile, type CodeViewItem } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';

const items: CodeViewItem[] = [
  {
    id: 'diff:src/app.ts',
    type: 'diff',
    fileDiff: parseDiffFromFile(oldAppFile, newAppFile),
    annotations: [{ side: 'additions', lineNumber: 2 }],
  },
  {
    id: 'file:README.md',
    type: 'file',
    file: readmeFile,
  },
];

<CodeView
  items={items}
  style={{ height: 600, overflow: 'auto' }}
  options={{
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    stickyHeaders: true,
    layout: { paddingTop: 16, paddingBottom: 16, gap: 12 },
  }}
/>
```

`CodeView` supports:
- **Controlled mode** — Pass `items` when React owns the full item list
- **Imperative mode** — Use `initialItems` plus a ref for imperative updates
- **Start empty** — Omit both to start empty and append later
- **`version`** — Bump to reset internal state
- **Selection** — Track selected items
- **`scrollTo`** — Programmatic scroll to specific items

### DiffOptions (Full Reference)

```typescript
interface DiffOptions {
  // Theming
  theme: { dark: 'pierre-dark', light: 'pierre-light' } | string;
  themeType: 'system' | 'dark' | 'light';
  preferredHighlighter: 'shiki-js' | 'shiki-wasm';

  // Diff Display
  diffStyle: 'split' | 'unified';
  diffIndicators: 'bars' | 'classic' | 'none';
  disableBackground: boolean;

  // Hunk Separators
  hunkSeparators: 'line-info' | 'line-info-basic' | 'metadata' | 'simple';
  expandUnchanged: boolean;
  expansionLineCount: number;
  collapsedContextThreshold: number;

  // Inline Change Highlighting
  lineDiffType: 'word-alt' | 'word' | 'char' | 'none';
  maxLineDiffLength: number;

  // Layout & Display
  disableLineNumbers: boolean;
  overflow: 'scroll' | 'wrap';
  disableFileHeader: boolean;
  disableErrorHandling: boolean;
  tokenizeMaxLineLength: number;

  // Post-Render Lifecycle
  onPostRender(node: HTMLElement, instance: FileDiffClass, phase: PostRenderPhase): void;

  // Line Selection
  enableLineSelection: boolean;
  onLineSelectionStart(range: SelectedLineRange | null): void;
  onLineSelectionChange(range: SelectedLineRange | null): void;
  onLineSelectionEnd(range: SelectedLineRange | null): void;
  onLineSelected(range: SelectedLineRange | null): void;

  // Mouse Events
  lineHoverHighlight: 'disabled' | 'both' | 'number' | 'line';
  enableGutterUtility: boolean;
  onLineClick({ lineNumber, side, event }): void;
  onLineNumberClick({ lineNumber, side, event }): void;
  onLineEnter({ lineNumber, side }): void;
  onLineLeave({ lineNumber, side }): void;

  // Token Hooks
  onTokenClick({ tokenText, lineNumber, lineCharStart, lineCharEnd, side }): void;
  onTokenEnter({ tokenText, lineNumber, lineCharStart, lineCharEnd, side, tokenElement }): void;
  onTokenLeave({ tokenText, side, tokenElement }): void;
  enableTokenInteractionsOnWhitespace: boolean;
  useTokenTransformer: boolean;

  // Gutter Utility
  onGutterUtilityClick(range: SelectedLineRange): void;
}
```

### Header Customization

- `renderHeaderPrefix` — Custom UI at the beginning of built-in header
- `renderHeaderMetadata` — Custom UI at the end of built-in header
- `renderCustomHeader` — Replace entire built-in header
- `options.collapsed` — Hide file body, keep header visible

### Post-Render Lifecycle

```typescript
options: {
  onPostRender(node, instance, phase) {
    // phase: 'mount' | 'update' | 'unmount'
    if (phase === 'mount') {
      const observer = new ResizeObserver(() => { /* measure */ });
      observer.observe(node);
    }
  }
}
```

---

## Vanilla JS API

Import from `@pierre/diffs`.

### Components

| Component | Purpose |
|---|---|
| `CodeView` | Mixed virtualized list of files and diffs |
| `FileDiff` | Compare two versions or render pre-parsed diff |
| `File` | Render a single code file |
| `UnresolvedFile` | Merge conflict resolution |

### FileDiff Example

```typescript
import { FileDiff, type FileContents } from '@pierre/diffs';

const oldFile: FileContents = { name: 'main.zig', contents: '...' };
const newFile: FileContents = { name: 'main.zig', contents: '...' };

const fileDiffInstance = new FileDiff({ theme: 'pierre-dark' });

// render() is synchronous. Syntax highlighting happens async in background
// and the diff updates automatically when complete.
fileDiffInstance.render({
  oldFile, newFile,
  containerWrapper: document.body,
});
```

**Key detail:** `FileDiff` uses reference equality to detect changes and skip unnecessary re-renders, so keep file object references stable.

---

## Utilities

### parseDiffFromFile

Generate `FileDiffMetadata` from two file versions. Includes `oldLines`/`newLines` for expand-unchanged.

### parsePatchFiles

Parse a unified diff/patch string into `ParsedPatch[]`. Supports cache key prefix for Worker Pool.

### setLanguageOverride

Change the language after creating a `FileContents` or `FileDiffMetadata`:

```typescript
import { setLanguageOverride } from '@pierre/diffs';
setLanguageOverride(diff, 'ruby');
```

---

## Worker Pool

Import from `@pierre/diffs/worker`. Offloads syntax highlighting to background threads.

Use `cacheKey` on `FileContents` and `FileDiffMetadata` for AST caching. The key must change whenever content, filename, or lang changes.

---

## SSR

Import from `@pierre/diffs/ssr`. Pre-render diffs with syntax highlighting on the server.

---

## Pierre Themes

The Pierre theme pack provides beautiful light and dark themes for:
- Visual Studio Code
- Cursor
- Zed
- Shiki (bundled with `@pierre/diffs`)

**Install:**
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pierrecomputer.pierre-theme)
- [Open VSX (Cursor)](https://open-vsx.org/extension/pierrecomputer/pierre-theme)
- [Zed Extensions](https://zed.dev/extensions/pierre-theme)

**Build custom themes:** Fork [github.com/pierrecomputer/theme](https://github.com/pierrecomputer/theme), modify the color palette, and regenerate.

Theme variants bundled with `@pierre/diffs`:
- `pierre-dark`
- `pierre-light`
- `pierre-dark-vibrant`
- `pierre-light-vibrant`

---

## Integration Considerations for NekoCode

### Current State

NekoCode's chat interface renders AI responses with code blocks and tool call results. The app currently:
- Shows tool call results (file reads, edits, writes) as text blocks
- May lack proper diff visualization for file changes
- May lack syntax-highlighted code rendering
- Needs merge conflict resolution when AI suggestions conflict

### Key Integration Points

#### 1. AI Chat Diff Rendering

When the AI suggests file changes, render them as interactive diffs:

```typescript
import { parseDiffFromFile } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';

// In chat message rendering:
const diff = parseDiffFromFile(
  { name: 'src/app.ts', contents: originalContent },
  { name: 'src/app.ts', contents: suggestedContent },
);

<FileDiff
  fileDiff={diff}
  options={{
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    diffStyle: 'unified',
    diffIndicators: 'classic',
    lineDiffType: 'word-alt',
  }}
/>
```

#### 2. CodeView for Multi-File Reviews

When the AI edits multiple files, show them in a single scrollable review surface:

```typescript
import { CodeView } from '@pierre/diffs/react';

<CodeView
  items={codeViewItems} // Mixed files and diffs
  options={{
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    stickyHeaders: true,
  }}
/>
```

#### 3. Accept/Reject AI Changes

Build an interactive review flow where users can accept or reject each AI-proposed change:

- Use annotations to track accept/reject state per change
- Render accept/reject buttons inline
- Provide visual feedback (strikethrough rejected, highlight accepted)
- Map to NekoCode's existing tool call infrastructure

#### 4. Merge Conflict Resolution

When AI changes conflict with user edits, use `UnresolvedFile` for resolution UI.

#### 5. File Preview in Chat

Use the `File` component to render syntax-highlighted code files inline in chat messages.

### Migration Path

1. **Phase 1: Basic diff rendering** — Add `@pierre/diffs` to render tool call edit results as diffs
2. **Phase 2: CodeView integration** — Use `CodeView` for multi-file change reviews
3. **Phase 3: Accept/Reject UX** — Build interactive accept/reject flow with annotations
4. **Phase 4: Merge conflicts** — Add `UnresolvedFile` for conflict resolution
5. **Phase 5: Token interactions** — Add LSP-powered token hover/tooltip integration
6. **Phase 6: Worker pool** — Offload syntax highlighting for large diffs

### Key API Mapping

| NekoCode Concept | @pierre/diffs Equivalent |
|---|---|
| AI file edit result | `FileDiff` + `parseDiffFromFile()` |
| Multiple file changes | `CodeView` with mixed items |
| Accept/reject changes | Annotations + custom render |
| Code block in chat | `File` component |
| Merge conflict | `UnresolvedFile` component |
| Patch from Git | `PatchDiff` + `parsePatchFiles()` |
| Syntax highlighting | Built-in via Shiki |
| Theme matching | `pierre-dark`/`pierre-light` + `themeType: 'system'` |

---

## Resources

- **Website:** https://diffs.com/
- **Documentation:** https://diffs.com/docs
- **Theme page:** https://diffs.com/theme
- **Playground:** https://diffs.com/playground
- **Changelog:** https://diffs.com/log
- **GitHub:** https://github.com/pierrecomputer/pierre (monorepo)
- **Discord:** https://discord.gg/pierre
- **npm:** https://www.npmjs.com/package/@pierre/diffs
- **Pierre Theme repo:** https://github.com/pierrecomputer/theme
