# @pierre/trees — File Tree Rendering Library

> **Research Document** — Comprehensive analysis of [trees.software](https://trees.software/) for NekoCode integration planning.

## Overview

`@pierre/trees` is an open-source file tree rendering library by [The Pierre Computer Company](https://pierre.computer/). It is built for performance and flexibility, is super customizable, and comes packed with features. Currently at **v1.0.0-beta.4**.

- **Website:** https://trees.software/
- **Docs:** https://trees.software/docs
- **Package:** `@pierre/trees` (npm)
- **Install:** `bun add @pierre/trees`
- **Made by:** The Pierre Computer Company (team with 150+ years combined experience from Cloudflare, Coinbase, Discord, GitHub, Reddit, Stripe, X)

---

## Why This Matters for NekoCode

NekoCode's current `TreeSidebar` component handles file tree rendering. `@pierre/trees` provides a production-grade, virtualized, feature-rich replacement that would give us:

1. **Built-in virtualization** — Trees with tens of thousands of items render instantly; only visible rows are mounted
2. **Git status integration** — Native support for added/modified/deleted/renamed/untracked/ignored indicators
3. **Inline rename & drag-and-drop** — Out-of-the-box file manipulation UX
4. **Search with multiple modes** — Hide/collapse/expand non-matches
5. **Context menu composition** — Custom right-click menus with trigger modes
6. **SSR & hydration** — Server-side preload for fast first paint
7. **Shadow DOM isolation** — Fewer DOM nodes, faster rendering
8. **Path-first identity model** — Consistent state management via canonical paths

---

## Core Architecture

### Path-First Identity Model

The central design principle: **canonical path strings are the public identity for every item**. For example, `src/components/Button.tsx` is not just a label — it is the value you read from selection state, the path you focus programmatically, and the target you rename or move later.

This applies uniformly to:
- Selection values
- Focused-item lookups
- Search matches
- Rename and drag-and-drop events
- Git status attachment
- Row annotations

### Dual Runtime: React + Vanilla

Trees exposes two primary runtime entry points:

| Entry Point | Import | Use When |
|---|---|---|
| React | `@pierre/trees/react` | Surrounding UI is React |
| Vanilla JS | `@pierre/trees` | Non-React app, or wrapping in another framework |

Both consume the **same tree data** and share the **same path-first model**. SSR is a third layer that builds on top of either runtime.

### Model-First Philosophy

The model owns the tree state. The component only renders it.

- React: `useFileTree(...)` creates one stable model; `<FileTree model={model} />` renders it
- Vanilla: `new FileTree(...)` creates the model; `fileTree.render(...)` mounts it
- Updates happen through model methods (`resetPaths()`, `setGitStatus()`, etc.), NOT through controlled re-renders

---

## Key Features

### 1. Flatten Empty Directories

Enable `flattenEmptyDirectories` to collapse single-child folder chains into one row for a more compact tree. For example:

```
.github/workflows/build/assets/images/social/logo.png
```

Instead of showing each nested directory as a separate expandable node, it renders as one combined row.

### 2. Git Status on Files

The `gitStatus` option shows status badges for:
- `M` — modified (tracked file with uncommitted changes)
- `A` — added (new file staged in the working tree)
- `D` — deleted (tracked file removed from the working tree)
- `R` — renamed (tracked file moved or renamed)
- `U` — untracked (new file not yet tracked by Git)
- None — ignored (path excluded by gitignore; inherits muted styling)
- `●` — descendant (folder contains changed descendants)

Folders with changed descendants get a dot indicator automatically. Update status at runtime with `fileTree.setGitStatus(nextStatuses)`.

### 3. Context Menu Composition

Render custom context menus via `composition.contextMenu` and the React `renderContextMenu` prop. Supports:
- Trigger modes: right-click, trigger button, or both
- Menu actions: new files, new folders, rename, delete
- Compatible with any UI component library (Shadcn, Radix, etc.)

### 4. Drag and Drop

Move files and folders by dragging them onto other folders, flattened folders, or the root with `dragAndDrop: true`. Features:
- Drop targets open automatically on hover
- Dragging is disabled while search is active
- `canDrag` callback to prevent specific paths from being dragged
- `canDrop` to reject invalid destinations
- `onDropComplete` for persistence updates
- `onDropError` for visible failures

### 5. Search and Filter

Three search modes via `fileTreeSearchMode`:

| Mode | Behavior |
|---|---|
| `hide-non-matches` | Hides files and folders without any matches (recommended default) |
| `collapse-non-matches` | Collapses folders without any matches, keeps tree structure |
| `expand-matches` | Keeps all items visible and expands folders with matches |

### 6. Always Virtualized

Trees with tens of thousands of items render instantly with built-in automatic virtualization. Only visible rows are mounted. No custom virtualization primitives needed.

### 7. Custom Row Annotations

`renderRowDecoration` adds non-Git row metadata such as:
- Generated-file markers
- Remote-storage indicators
- Validation markers
- Short secondary labels

### 8. Icon Customization

Three built-in icon sets:
- `minimal` — low-noise file and folder visuals
- `standard` — common language and file-type recognition
- `complete` — broadest built-in coverage

Custom icons via:
- `byFileName` — exact basename matches (e.g., `package.json`)
- `byFileExtension` — suffixes (e.g., `ts` or `spec.ts`)
- `byFileNameContains` — broader patterns (e.g., `dockerfile`)
- `remap` — built-in slot remapping
- `spriteSheet` — custom SVG symbols

### 9. SSR & Hydration

Server-side preload for fast first paint:

```typescript
import { preloadFileTree } from '@pierre/trees/ssr';

const payload = preloadFileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  search: true,
  initialVisibleRowCount: 11,
});
```

Client hydrates the server-rendered tree. Uses declarative Shadow DOM under the hood.

---

## React API Quick Reference

### Setup

```typescript
import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });
  return <FileTree model={model} className="h-96 rounded-lg border" />;
}
```

### With Prepared Input (Recommended for Scale)

```typescript
import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';

export function ProjectTree({ preparedInput }: { preparedInput: FileTreePreparedInput }) {
  const { model } = useFileTree({
    preparedInput,
    search: true,
    initialExpandedPaths: ['src', 'src/components'],
  });
  return <FileTree model={model} className="rounded-lg border" style={{ height: '320px' }} />;
}
```

### Selector Hooks

```typescript
import {
  FileTree, useFileTree, useFileTreeSearch, useFileTreeSelection,
} from '@pierre/trees/react';

const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
// Custom derived snapshots:
const value = useFileTreeSelector(model, selector, equalityFn?);
```

### Rename + Context Menu

```typescript
const { model } = useFileTree({
  paths,
  composition: {
    contextMenu: { enabled: true, triggerMode: 'both', buttonVisibility: 'when-needed' },
  },
  renaming: {
    canRename: (item) => item.path !== 'package.json',
    onRename: ({ sourcePath, destinationPath }) => { /* persist */ },
    onError: (message) => { /* surface error */ },
  },
});

<FileTree
  model={model}
  renderContextMenu={(item, context) => (
    <div className="rounded-md border bg-background p-2 shadow">
      <button onClick={() => { context.close({ restoreFocus: false }); model.startRenaming(item.path); }}>
        Rename
      </button>
    </div>
  )}
/>;
```

### Drag and Drop

```typescript
const fileTree = new FileTree({
  paths,
  dragAndDrop: {
    canDrag: (draggedPaths) => !draggedPaths.includes('package.json'),
    canDrop: ({ target }) => target.directoryPath !== 'dist/',
    onDropComplete: ({ draggedPaths, target }) => { /* persist */ },
    onDropError: (message) => { /* surface error */ },
  },
});
```

### Styling & Theming

```typescript
// CSS variables are the main styling surface
<FileTree
  model={model}
  style={{
    '--trees-theme-list-active-selection-bg': 'color-mix(in oklab, var(--accent) 24%, transparent)',
    '--trees-theme-list-hover-bg': 'color-mix(in oklab, var(--accent) 12%, transparent)',
    '--trees-theme-focus-ring': 'var(--accent)',
  } as React.CSSProperties}
/>

// Match an editor palette
import { themeToTreeStyles } from '@pierre/trees';
const treeStyles = themeToTreeStyles(theme);
```

Density presets: `'compact'` | `'default'` | `'relaxed'` (or custom numeric factor).

### Escape Hatch: unsafeCSS

```typescript
const fileTree = new FileTree({
  paths,
  unsafeCSS: `
    [data-item-button][data-item-focused="true"] {
      text-decoration: underline;
    }
  `,
});
```

---

## Vanilla JS API Quick Reference

### Setup

```typescript
import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
});

const container = document.getElementById('project-tree');
if (container instanceof HTMLElement) {
  fileTree.render({ fileTreeContainer: container });
}
```

### Model Methods

```typescript
fileTree.focusPath('src/index.ts');
fileTree.openSearch('button');
const selectedPaths = fileTree.getSelectedPaths();
const matchingPaths = fileTree.getSearchMatchingPaths();
const focusedPath = fileTree.getFocusedPath();
const buttonItem = fileTree.getItem('src/components/Button.tsx');
buttonItem?.select();
fileTree.setGitStatus(nextStatuses);
fileTree.resetPaths(newPaths);
```

---

## Input Preparation for Performance

### Three Input Shapes

| Shape | Use Case | Performance |
|---|---|---|
| `paths` (raw) | Small demos, tests, very small static trees | Lowest |
| `preparedInput` | Recommended for larger trees | High |
| `preparePresortedFileTreeInput(...)` | Server already knows final order | Highest |

### Prepare on Server, Render on Client

```typescript
import { prepareFileTreeInput } from '@pierre/trees';

export async function loadProjectTreeInput(projectId: string) {
  const paths = await fetchProjectPaths(projectId);
  return prepareFileTreeInput(paths, { flattenEmptyDirectories: true });
}
```

### Presorted (Highest Performance)

```typescript
import { preparePresortedFileTreeInput } from '@pierre/trees';

const preparedInput = preparePresortedFileTreeInput([
  'README.md', 'src/index.ts', 'src/components/Button.tsx',
]);
```

---

## Shared Option Reference

| Option | Meaning | Typical Use |
|---|---|---|
| `paths` | Raw canonical path list | Small demos, tests |
| `preparedInput` | Pre-shaped tree input | Recommended for larger trees |
| `id` | Stable host identity for SSR coordination | SSR/hydration |
| `initialExpansion` | Baseline expansion policy | Start broadly open/closed or at specific depth |
| `initialExpandedPaths` | Specific paths that begin expanded | Keep key folders open |
| `initialSelectedPaths` | Paths selected on first render | Preview/restored state |
| `flattenEmptyDirectories` | Collapse single-child chains | Compact repo-style trees |
| `sort` | Client-side ordering | When order must be chosen in client |
| `search` | Enable built-in search surface | Searchable trees |
| `initialSearchQuery` | Starting search value | Preloaded filtered views |
| `fileTreeSearchMode` | How matches change visible tree | `hide-non-matches` / `collapse-non-matches` / `expand-matches` |
| `dragAndDrop` | Enable DnD + policy hooks | Editable trees |
| `renaming` | Enable inline rename + policy hooks | Rename workflows |
| `composition` | Header/context-menu composition | Contextual commands |
| `gitStatus` | Built-in Git-style row signals | Git integration |
| `icons` | Built-in icon set or config | Set selection, color, remaps, sprites |
| `renderRowDecoration` | Custom non-Git row signal | Generated badges, remote markers |
| `density` | Density preset or spacing factor | Row height & spacing |
| `itemHeight` | Explicit row-height override | When no density preset matches |
| `overscan` | Extra rows outside visible window | Smooth scrolling tradeoffs |
| `initialVisibleRowCount` | First-render row budget | SSR/hydration tuning |
| `unsafeCSS` | CSS injection into shadow root | Narrow escape hatch |

---

## Mutation Vocabulary

Trees exposes semantic tree mutations rather than DOM events:
- `add` — Add items
- `remove` — Remove items
- `move` — Move items
- `batch` — Batch mutations
- `resetPaths` — Reset all paths
- `onMutation` — Mutation callback

Mutation payloads stay path-first. Reset events tell you whether prepared input was involved.

---

## SSR Flow

### Server Step

```typescript
import { preloadFileTree } from '@pierre/trees/ssr';
const payload = preloadFileTree({ preparedInput, id: 'project-tree', ... });
```

### React Client Hydration

```typescript
const { model } = useFileTree({ preparedInput, id: preloadedData.id, ... });
return <FileTree model={model} preloadedData={preloadedData} />;
```

### Vanilla Client Hydration

```typescript
const fileTree = new FileTree({ preparedInput, id: 'project-tree', ... });
fileTree.hydrate({ fileTreeContainer: container });
```

**Key invariant:** Server and client must agree on the same tree-defining options.

---

## Integration Considerations for NekoCode

### Current State

NekoCode uses a custom `TreeSidebar` component in `src/renderer/src/components/layout/`. The current implementation likely:
- Renders files from project-store state
- Handles click-to-open in editor
- May lack virtualization for large repos
- May lack native Git status display
- May lack inline rename/drag-and-drop

### Migration Path

1. **Phase 1: Drop-in replacement** — Replace TreeSidebar internals with `@pierre/trees/react`, using raw `paths` input initially
2. **Phase 2: Prepared input** — Move tree shaping to main process, pass `preparedInput` via IPC
3. **Phase 3: Git status** — Pipe Git status from main process to `gitStatus` option
4. **Phase 4: Interactions** — Enable rename, drag-and-drop, context menus
5. **Phase 5: SSR** — Preload tree data in main process for fast first paint

### Key API Mapping

| NekoCode Concept | @pierre/trees Equivalent |
|---|---|
| Project file list | `paths` or `preparedInput` |
| File click handler | `onSelectionChange` + focused path |
| Git status display | `gitStatus` option |
| Context menu | `composition.contextMenu` + `renderContextMenu` |
| File rename | `renaming` option + `onRename` |
| File move | `dragAndDrop` option + `onDropComplete` |
| Search/filter | `search` option + `useFileTreeSearch` |

### Package Entry Points

| Import | Purpose |
|---|---|
| `@pierre/trees` | Vanilla runtime + shared types |
| `@pierre/trees/react` | React components & hooks |
| `@pierre/trees/ssr` | Server-side preload utilities |

---

## Resources

- **Website:** https://trees.software/
- **Documentation:** https://trees.software/docs
- **GitHub:** https://github.com/pierrecomputer/pierre (monorepo)
- **Discord:** https://discord.gg/pierre
- **npm:** https://www.npmjs.com/package/@pierre/trees
