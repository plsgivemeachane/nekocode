---
title: "shadcn/ui Migration - Phase 0 & 1 Foundation"
date: 2026-05-31
status: completed
type: feature
---

# shadcn/ui Migration - Phase 0 & 1

## Summary

Executed Phase 0 (Foundation Setup) and Phase 1 (First Components) of the shadcn/ui migration plan defined in `docs/research/shadcn-migration-plan.md`.

## Phase 0: Foundation Setup

### 0.1 Created `components.json` manually
- The interactive `shadcn init` CLI doesn't work well with non-Next.js projects
- Manually created with `style: "new-york"`, `rsc: false`, `tsx: true`
- Aliases point to `@/renderer/src/components`, `@/renderer/src/lib`, etc.

### 0.2 Installed core dependencies
- `@radix-ui/react-dialog`, `@radix-ui/react-context-menu`, `@radix-ui/react-switch`, etc.
- Utility deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
- The `radix-ui` meta-package was auto-installed by shadcn CLI

### 0.3 Created `src/renderer/src/lib/utils.ts`
- Standard `cn()` utility combining `clsx` + `tailwind-merge`

### 0.4 Added Vite resolve alias
- Added `resolve.alias: { '@': new URL('./src', import.meta.url).pathname }` to the renderer config in `electron.vite.config.ts`
- tsconfig already had `@/*` -> `./src/*` path mapping

### 0.5 Bridge CSS tokens
- Added shadcn semantic tokens inside `@theme` block in `index.css`
- All tokens bridge FROM existing NekoCode design tokens (e.g., `--color-background: var(--color-surface-950)`)
- **No color schema was changed** -- existing NekoCode colors are preserved
- Added `:root` CSS custom properties in `@layer base` for components that use `var(--background)` pattern

## Phase 1: Component Installation & Migration

### 1A: Button component
- Added via `bunx --bun shadcn@latest add button`
- Generated at `src/renderer/src/components/ui/button.tsx`
- Not yet integrated into existing code (available for future use)

### 1B: Dialog component
- Added via `bunx --bun shadcn@latest add dialog`
- Generated at `src/renderer/src/components/ui/dialog.tsx`
- Not yet integrated into existing code (available for future use)

### 1C: ContextMenu component + TreeSidebar migration
- Added via `bunx --bun shadcn@latest add context-menu`
- **Migrated TreeSidebar** from imperative custom ContextMenu to declarative Radix ContextMenu:
  - Removed `ctxMenu` state, `closeCtxMenu`, `openProjectMenu`, `openSessionMenu` callbacks
  - Replaced with `renderProjectMenu()` and `renderSessionMenu()` render functions that return JSX
  - Project rows wrapped in `<ContextMenu><ContextMenuTrigger>...<ContextMenuContent>...</ContextMenuContent></ContextMenu>`
  - Session rows wrapped similarly inside SessionList component
  - Changed `onContextMenu` prop to `renderSessionMenu` prop on SessionList
  - Menu items use shadcn `<ContextMenuItem>`, `<ContextMenuSeparator>`, `<ContextMenuShortcut>`
  - Destructive items use `variant="destructive"` prop
  - Custom styling preserves NekoCode color schema: `bg-surface-900/95 backdrop-blur-md border-surface-700/60`
- Old `ContextMenu.tsx` is now orphaned (no imports), tests still pass against old component

### 1D: Switch + Toggle components
- Added via `bunx --bun shadcn@latest add switch` and `add toggle`
- Available for future integration

## Files Changed

- `components.json` -- NEW
- `src/renderer/src/lib/utils.ts` -- NEW
- `src/renderer/src/index.css` -- Added shadcn semantic tokens + CSS variables
- `electron.vite.config.ts` -- Added `resolve.alias` for renderer
- `src/renderer/src/components/layout/TreeSidebar.tsx` -- Migrated to Radix ContextMenu
- `src/renderer/src/components/ui/button.tsx` -- NEW (shadcn)
- `src/renderer/src/components/ui/dialog.tsx` -- NEW (shadcn)
- `src/renderer/src/components/ui/context-menu.tsx` -- NEW (shadcn)
- `src/renderer/src/components/ui/switch.tsx` -- NEW (shadcn)
- `src/renderer/src/components/ui/toggle.tsx` -- NEW (shadcn)
- `package.json` / `bun.lock` -- Added Radix + utility deps

## Validation Results

- `bun run type-check` -- passes
- `bun run build` -- passes
- `bun run lint` -- passes
- `bun run test` -- all tests pass (including existing ContextMenu tests)
