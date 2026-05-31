# NekoCode UI Refactoring Plan: Custom UI → shadcn/ui

> **Status:** Planning  
> **Date:** 2026-05-31  
> **Scope:** Full replacement of hand-rolled UI primitives with shadcn/ui components  
> **Risk Level:** Medium-High (Electron + Tailwind v4 + no existing component library)

---

## Executive Summary

NekoCode's current UI is built entirely from scratch using raw React + Tailwind CSS classes. There are **zero** UI component library dependencies — no Radix, no shadcn, no headless UI. Every overlay, dropdown, toggle, tooltip, context menu, and dialog is hand-implemented with manual `createPortal`, `useEffect` for click-outside, inline positioning math, and ad-hoc ARIA attributes.

This creates several problems:
1. **Maintenance burden** — Every interaction pattern (dropdown, dialog, popover) has bespoke positioning/focus-trap/click-outside logic that must be maintained independently
2. **Accessibility gaps** — Hand-rolled ARIA is inconsistent; no proper focus trapping, roving tabindex, or screen reader announcements
3. **Visual inconsistency** — No design tokens or component API conventions; each component invents its own spacing/color/animation patterns
4. **Feature velocity** — Adding new UI patterns requires re-implementing primitives instead of composing existing ones

shadcn/ui (Rhea/2025) directly addresses all four problems: it provides Radix-based primitives with full ARIA, a CSS-variable token system, copy-paste ownership, and composable APIs — all compatible with Tailwind v4 and React 19.

---

## Current State Analysis

### Dependency Profile
| Category | Current | Target |
|---|---|---|
| UI Framework | None (raw React) | shadcn/ui (Radix primitives) |
| Styling | Tailwind v4 (`@import "tailwindcss"`) | Tailwind v4 + CSS variable tokens |
| Component Library | 0 dependencies | `@radix-ui/*` (via shadcn) |
| CSS Variables | `--surface-*`, `--text-*`, `--accent-*` (custom) | `--background`, `--foreground`, `--primary`, etc. (shadcn tokens) |
| State Management | React Context + useReducer | No change |
| Virtualization | `react-virtuoso` | No change |
| Markdown | `react-markdown` + `shiki` | No change |

### Hand-Rolled Components Inventory

| Component | File | Lines | Pattern | shadcn Replacement |
|---|---|---|---|---|
| ContextMenu | `ui/ContextMenu.tsx` | 135 | Portal + manual positioning + click-outside | `ContextMenu` |
| Toggle | Inside `NotificationSettingsContent.tsx` | 25 | Button with `role="switch"` | `Switch` |
| NotificationSettingsContent | `ui/NotificationSettingsContent.tsx` | 245 | Inline form with toggles, sliders, selects | `Card` + `Switch` + `Slider` + `Select` |
| NotificationSettingsPanel | `ui/NotificationSettingsPanel.tsx` | 46 | Floating panel | `Popover` or `Dialog` |
| WelcomeScreen | `ui/WelcomeScreen.tsx` | 285 | Custom layout with keyboard shortcuts grid | `Card` + `Badge` + `Kbd` |
| Git overlay modal | Inside `App.tsx` | ~50 | Portal + backdrop blur + click-outside | `Dialog` |
| CommandPalette | `chat/CommandPalette.tsx` | 303 | Portal + search + keyboard nav | `Command` (cmdk) |
| GlobalCommandPalette | `chat/GlobalCommandPalette.tsx` | 266 | Portal + search + keyboard nav | `Command` (cmdk) |
| BranchSelector | `git/BranchSelector.tsx` | 167 | Click-outside + dropdown + list | `Popover` + `Command` |
| UIDialog | `chat/UIDialog.tsx` | 287 | Modal with form inputs, select, buttons | `Dialog` + `Input` + `Select` + `Button` |
| StatusDot | Multiple files | ~15 each | Colored circle | `Badge` (variant: dot) |
| Toast | Inside `TreeSidebar.tsx` | ~20 | Timed notification | `Sonner` (toast) |
| NavBar dropdown | Inside `NavBar.tsx` | ~40 | Click-outside dropdown | `DropdownMenu` |
| Sidebar resize | Inside `RightSidebar.tsx` | ~60 | Mouse drag handler | `Resizable` |
| DiffViewer | `git/DiffViewer.tsx` | — | Code diff display | Custom (keep) |
| ChatInput | `chat/ChatInput.tsx` | 290 | Textarea + file attachments | `Textarea` + `Button` (compose) |

### CSS Architecture (Current)
- **Tailwind v4** with `@import "tailwindcss"` (no `tailwind.config.js`)
- **Custom properties** defined in `index.css` (322 lines): `--surface-*`, `--text-*`, `--accent-*`, `--error-*`
- **No CSS layer system** — utilities and custom properties mixed
- **No `@theme` directive** — theme values are raw CSS custom properties
- **Dark mode only** — no light mode toggle

### Hooks That May Be Replaced
| Hook | File | Replaced By |
|---|---|---|
| `useClickOutside` | `hooks/useClickOutside.ts` | Radix `DismissableLayer` (built into shadcn components) |
| `useAutoScroll` | `hooks/useAutoScroll.ts` | Keep (chat-specific) |
| `useZoom` | `hooks/useZoom.ts` | Keep (app-specific) |

---

## Phased Refactoring Plan

### Phase 0: Foundation Setup (Days 1–3)
**Goal:** Install shadcn/ui, establish the design token bridge, and validate the build works.

#### Tasks
- [ ] **0.1 Install shadcn/ui CLI and init**
  ```powershell
  cd E:\project
ode
ekocode
  bunx shadcn@latest init
  ```
  - Choose: TypeScript, Tailwind v4, CSS variables, `src/renderer/src` as components path
  - This creates `components.json` with the shadcn configuration

- [ ] **0.2 Configure `components.json`**
  - Set `aliases.components` to `@/components/ui` (shadcn components)
  - Set `aliases.utils` to `@/lib/utils`
  - Set `tailwind.css` to `src/renderer/src/index.css`
  - Set `tailwind.config` to empty (Tailwind v4 doesn't use config files)

- [ ] **0.3 Install core Radix dependencies**
  ```powershell
  bun add @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-context-menu @radix-ui/react-dropdown-menu @radix-ui/react-switch @radix-ui/react-slider @radix-ui/react-select @radix-ui/react-tooltip @radix-ui/react-separator @radix-ui/react-scroll-area @radix-ui/react-tabs class-variance-authority clsx tailwind-merge lucide-react
  ```

- [ ] **0.4 Create `src/renderer/src/lib/utils.ts`**
  ```typescript
  import { clsx, type ClassValue } from "clsx"
  import { twMerge } from "tailwind-merge"
  
  export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
  }
  ```

- [ ] **0.5 Bridge CSS tokens: Map existing `--surface-*` / `--text-*` / `--accent-*` to shadcn's `--background` / `--foreground` / `--primary` system**
  - Add a `@theme` block in `index.css` that defines the shadcn CSS variable layer
  - Map existing tokens:
    ```css
    @theme {
      --color-background: var(--surface-950);
      --color-foreground: var(--text-primary);
      --color-card: var(--surface-900);
      --color-card-foreground: var(--text-primary);
      --color-popover: var(--surface-900);
      --color-popover-foreground: var(--text-primary);
      --color-primary: var(--accent-500);
      --color-primary-foreground: var(--surface-50);
      --color-secondary: var(--surface-800);
      --color-secondary-foreground: var(--text-primary);
      --color-muted: var(--surface-800);
      --color-muted-foreground: var(--text-tertiary);
      --color-accent: var(--accent-500);
      --color-accent-foreground: var(--surface-50);
      --color-destructive: var(--error-500);
      --color-destructive-foreground: var(--surface-50);
      --color-border: var(--surface-700);
      --color-input: var(--surface-700);
      --color-ring: var(--accent-400);
      --radius: 0.5rem;
    }
    ```
  - This preserves all existing `surface-*`/`text-*` classes while adding shadcn's semantic layer

- [ ] **0.6 Add shadcn CSS variables to `index.css`**
  - Add the `:root` / `.dark` CSS variable definitions that shadcn expects
  - Since NekoCode is dark-only, define them under `:root` directly

- [ ] **0.7 Validate build**
  ```powershell
  bun run type-check
  bun run dev  # Manual smoke test
  ```

**Exit Criteria:**
- `components.json` exists and `bunx shadcn@latest add button` works
- Build passes with no type errors
- Existing UI unchanged (new tokens are additive, not replacing)
- `cn()` utility available for all new components

---

### Phase 1: Core Primitives (Days 4–8)
**Goal:** Replace the most fundamental hand-rolled patterns — the ones that are reused everywhere or have the most accessibility gaps.

#### 1A: Button Component
- [ ] `bunx shadcn@latest add button`
- [ ] Audit all `<button>` usages across the renderer (currently ~40+ instances)
- [ ] Create a migration mapping:
  - `className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-800/60"` → `<Button variant="ghost" size="icon">`
  - `className="px-3 py-1.5 rounded-lg bg-accent-500 text-surface-50 hover:bg-accent-600"` → `<Button variant="default">`
  - `className="px-3 py-1.5 rounded-lg border border-surface-700 text-text-secondary hover:bg-surface-800"` → `<Button variant="outline">`
  - Danger buttons → `<Button variant="destructive">`
- [ ] Migrate button usages **file by file**, starting with:
  1. `NavBar.tsx` (6–8 buttons)
  2. `TreeSidebar.tsx` (4–5 buttons)
  3. `ChatInput.tsx` (3–4 buttons)
  4. `RightSidebar.tsx` (3–4 buttons)
  5. `WelcomeScreen.tsx` (1 button)
  6. Git components (5–6 buttons)
- [ ] Verify visual parity after each file migration

#### 1B: Dialog / Modal
- [ ] `bunx shadcn@latest add dialog`
- [ ] **Replace Git overlay in `App.tsx`** (currently hand-rolled backdrop + portal)
  - The existing code at ~line 73 of App.tsx uses a `fixed inset-0 z-50` div with manual click-outside → Replace with `<Dialog>` + `<DialogContent>`
- [ ] **Replace `UIDialog`** (`chat/UIDialog.tsx`, 287 lines)
  - This is the most complex custom dialog — it renders AI-requested UI dialogs with form inputs, selects, and buttons
  - Replace with `<Dialog>` + `<DialogContent>` + `<DialogHeader>` + `<DialogFooter>`
  - Internal form elements will use shadcn `Input` and `Select` (added in Phase 2)
- [ ] Add `DialogClose` for the close buttons
- [ ] Verify focus trapping works correctly (Radix handles this automatically)

#### 1C: ContextMenu
- [ ] `bunx shadcn@latest add context-menu`
- [ ] **Replace `ui/ContextMenu.tsx`** (135 lines of hand-rolled portal + positioning)
  - Current API: `<ContextMenu x={x} y={y} items={items} onClose={onClose} />`
  - New API: `<ContextMenu><ContextMenuTrigger>...</ContextMenuTrigger><ContextMenuContent>...</ContextMenuContent></ContextMenu>`
  - This is an **API change** — consumers must be updated
  - Search all usages: `ContextMenu` is imported in `TreeSidebar.tsx`, `AssistantMessage.tsx`, potentially others
- [ ] Convert `ContextMenuEntry[]` items to `<ContextMenuItem>` JSX children
- [ ] Map separators: `type: 'separator'` → `<ContextMenuSeparator />`
- [ ] Map danger items: `danger?: boolean` → `<ContextMenuItem className="text-destructive">`
- [ ] Map shortcuts: `shortcut?: string` → `<ContextMenuShortcut>`
- [ ] Delete `ui/ContextMenu.tsx` after migration
- [ ] Delete `hooks/useClickOutside.ts` if no other consumers remain

#### 1D: Switch (Toggle)
- [ ] `bunx shadcn@latest add switch`
- [ ] **Replace inline `Toggle` component** in `NotificationSettingsContent.tsx`
  - Current: 25-line hand-rolled `<button role="switch">` with manual `translate-x` animation
  - New: `<Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />`
- [ ] Verify animation matches existing behavior

**Exit Criteria:**
- All dialogs use `<Dialog>`, no manual portals for modals
- Context menu uses Radix, no manual positioning
- All toggles use `<Switch>`
- Build passes, no visual regressions
- `useClickOutside` hook removed (or tracked for removal if still used elsewhere)

---

### Phase 2: Form & Input Components (Days 9–14)
**Goal:** Replace all hand-rolled form controls with shadcn equivalents.

#### 2A: Input & Textarea
- [ ] `bunx shadcn@latest add input`
- [ ] `bunx shadcn@latest add textarea`
- [ ] **Migrate `ChatInput.tsx`** (290 lines)
  - The main chat input is a custom `<textarea>` with auto-resize, file attachment buttons, and keyboard handling
  - Replace the `<textarea>` element with `<Textarea>` from shadcn
  - Keep the auto-resize logic (custom hook), just swap the element
  - Keep the attachment/compose UI, just use `<Button>` for attachment buttons
- [ ] **Migrate `CommitInput.tsx`** (git commit message input)
  - Replace raw `<textarea>` with `<Textarea>`
- [ ] **Migrate `UIDialog` form inputs** (if not done in Phase 1B)
  - Replace raw `<input>` elements with `<Input>`
- [ ] **Migrate `BranchSelector.tsx`** search input
  - Replace raw `<input>` with `<Input>`

#### 2B: Select
- [ ] `bunx shadcn@latest add select`
- [ ] **Migrate `UIDialog` select dropdowns** (AI-requested UI dialogs with `<select>`)
  - Current: raw `<select>` or custom dropdown
  - New: `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`
- [ ] **Migrate `NavBar` project selector** (if it uses a dropdown)

#### 2C: Popover
- [ ] `bunx shadcn@latest add popover`
- [ ] **Replace `NotificationSettingsPanel.tsx`** (46 lines)
  - Current: floating panel with manual positioning
  - New: `<Popover>` + `<PopoverTrigger>` + `<PopoverContent>`
- [ ] **Replace `BranchSelector.tsx` dropdown** (167 lines)
  - Current: click-outside + manual dropdown with search
  - New: `<Popover>` + `<Command>` (combo pattern from shadcn)
  - This eliminates `useClickOutside` usage in BranchSelector

#### 2D: Slider
- [ ] `bunx shadcn@latest add slider`
- [ ] **Migrate volume sliders** in `NotificationSettingsContent.tsx`
  - Current: raw `<input type="range">` with custom styling
  - New: `<Slider>`

#### 2E: Label
- [ ] `bunx shadcn@latest add label`
- [ ] Add proper `<Label>` to all form fields in:
  - `NotificationSettingsContent.tsx`
  - `UIDialog.tsx`
  - `SettingsView.tsx`

**Exit Criteria:**
- No raw `<input>`, `<textarea>`, `<select>` elements remain in renderer
- All form controls use shadcn primitives
- All form fields have proper `<Label>` associations
- `useClickOutside` hook fully removed

---

### Phase 3: Navigation & Overlay Components (Days 15–20)
**Goal:** Replace all navigation, dropdown, and overlay patterns.

#### 3A: DropdownMenu
- [ ] `bunx shadcn@latest add dropdown-menu`
- [ ] **Replace NavBar dropdown** (inside `NavBar.tsx`)
  - Current: manual click-outside dropdown
  - New: `<DropdownMenu>` + `<DropdownMenuTrigger>` + `<DropdownMenuContent>` + `<DropdownMenuItem>`
- [ ] **Replace any right-click menus** not covered by ContextMenu in Phase 1C
- [ ] **Replace `TreeSidebar.tsx` project action menus**

#### 3B: Command Palette (cmdk)
- [ ] `bunx shadcn@latest add command`
- [ ] **Replace `CommandPalette.tsx`** (303 lines)
  - Current: hand-rolled portal + search + keyboard nav + filtering
  - New: `<Command>` + `<CommandInput>` + `<CommandList>` + `<CommandItem>` + `<CommandEmpty>`
  - Wrap in `<Dialog>` for the modal overlay
- [ ] **Replace `GlobalCommandPalette.tsx`** (266 lines)
  - Same pattern as above
  - This is the Ctrl+K command palette
- [ ] Delete both custom implementations
- [ ] Verify keyboard navigation (↑↓ arrows, Enter, Escape) works correctly

#### 3C: Tooltip
- [ ] `bunx shadcn@latest add tooltip`
- [ ] Add `<Tooltip>` to all icon-only buttons (currently using `title` attribute):
  - NavBar buttons
  - TreeSidebar buttons
  - RightSidebar rail items
  - Git action buttons
- [ ] Replace `title="..."` with `<Tooltip><TooltipTrigger>...</TooltipTrigger><TooltipContent>...</TooltipContent></Tooltip>`

#### 3D: ScrollArea
- [ ] `bunx shadcn@latest add scroll-area`
- [ ] **Replace custom scrollbar styling** in `index.css` (lines with `::-webkit-scrollbar`)
  - Wrap scrollable areas in `<ScrollArea>` instead of custom CSS
  - Target: `ChatView` message list, `TreeSidebar` file tree, `RightSidebar` content panels

#### 3E: Tabs
- [ ] `bunx shadcn@latest add tabs`
- [ ] **Migrate `SettingsView.tsx`** if it uses tabs
- [ ] **Migrate `GitView.tsx` / `GitCommandCenter.tsx`** tab navigation
  - Current: likely manual tab state
  - New: `<Tabs>` + `<TabsList>` + `<TabsTrigger>` + `<TabsContent>`

**Exit Criteria:**
- No manual dropdown/overlay positioning code remains
- Command palette uses cmdk via shadcn
- All icon buttons have proper tooltips
- Scroll areas use Radix ScrollArea
- `createPortal` calls reduced to near-zero (only for truly custom overlays)

---

### Phase 4: Layout & Presentation Components (Days 21–28)
**Goal:** Replace layout, card, badge, and structural components.

#### 4A: Card
- [ ] `bunx shadcn@latest add card`
- [ ] **Migrate `WelcomeScreen.tsx`** (285 lines)
  - Current: custom divs with rounded corners and borders
  - New: `<Card>` + `<CardHeader>` + `<CardTitle>` + `<CardContent>`
- [ ] **Migrate `NotificationSettingsContent.tsx`** sections into `<Card>` blocks
- [ ] **Migrate `SettingsView.tsx`** sections into `<Card>` blocks

#### 4B: Badge
- [ ] `bunx shadcn@latest add badge`
- [ ] **Replace `StatusDot`** components (in `ToolCallSection.tsx`, `TreeSidebar.tsx`)
  - Current: `<span>` with colored background circle
  - New: `<Badge variant="outline">` with custom dot indicator
- [ ] **Replace `DiffStatsBadge`** in `ToolCallSection.tsx`
  - Current: custom span with +3/-1 format
  - New: `<Badge variant="secondary">`

#### 4C: Separator
- [ ] `bunx shadcn@latest add separator`
- [ ] Replace `<div className="h-px bg-surface-700">` patterns throughout:
  - ContextMenu separators (already handled in Phase 1C)
  - NavBar dividers
  - RightSidebar section dividers
  - TreeSidebar dividers

#### 4D: Resizable Panels
- [ ] `bunx shadcn@latest add resizable`
- [ ] **Replace sidebar resize logic** in `RightSidebar.tsx`
  - Current: ~60 lines of `mousedown`/`mousemove`/`mouseup` handler
  - New: `<ResizablePanelGroup>` + `<ResizablePanel>` + `<ResizableHandle>`
- [ ] **Consider applying to `TreeSidebar`** width as well
- [ ] **Consider applying to the main content split** (sidebar | content | right sidebar)

#### 4E: Sheet (slide-over panel)
- [ ] `bunx shadcn@latest add sheet`
- [ ] **Consider replacing `NotificationSettingsPanel.tsx`** with `<Sheet>` instead of `<Popover>` if it's a side panel
- [ ] **Consider for future mobile/narrow layouts**

#### 4F: Accordion
- [ ] `bunx shadcn@latest add accordion`
- [ ] **Migrate `SettingsView.tsx`** collapsible sections (if any)
- [ ] **Migrate `WelcomeScreen.tsx`** tips sections (if collapsible)

#### 4G: Kbd (Keyboard Shortcut Display)
- [ ] Create a custom `Kbd` component (not in shadcn core, but simple)
  - Used in `WelcomeScreen.tsx` for keyboard shortcut display
  - Pattern: `<kbd className="px-1.5 py-0.5 text-xs rounded bg-surface-800 border border-surface-700 text-text-tertiary">Ctrl+K</kbd>`
  - Create as `src/renderer/src/components/ui/kbd.tsx`

**Exit Criteria:**
- All card-like containers use `<Card>`
- All status indicators use `<Badge>`
- Sidebar resize uses `<ResizablePanelGroup>`
- No raw `<div>` separator patterns remain
- Build and visual parity maintained

---

### Phase 5: Polish, Accessibility & Cleanup (Days 29–35)
**Goal:** Final pass for accessibility, dark mode consistency, dead code removal, and visual polish.

#### 5A: Accessibility Audit
- [ ] Run accessibility audit on all migrated components
- [ ] Verify focus management in all dialogs (Radix should handle, but verify)
- [ ] Verify keyboard navigation:
  - Tab order in NavBar, TreeSidebar, ChatInput, RightSidebar
  - Arrow key navigation in dropdowns, command palette, context menus
  - Escape key behavior (close dialogs, menus, overlays)
- [ ] Add `aria-label` to all icon-only buttons
- [ ] Verify screen reader announcements for toasts, status changes, errors
- [ ] Test with keyboard-only navigation through entire app

#### 5B: Dark Mode Token Consistency
- [ ] Audit all remaining `surface-*`, `text-*`, `accent-*` usages
- [ ] Ensure shadcn CSS variables are the single source of truth
- [ ] Map remaining legacy token usages to shadcn equivalents:
  - `bg-surface-900` → `bg-card` / `bg-popover`
  - `bg-surface-950` → `bg-background`
  - `text-text-primary` → `text-foreground`
  - `text-text-secondary` → `text-muted-foreground`
  - `text-text-tertiary` → `text-muted-foreground`
  - `border-surface-700` → `border-border`
  - `bg-accent-500` → `bg-primary`
  - `text-error-500` → `text-destructive`
- [ ] Update `index.css` to use `@theme` directive for Tailwind v4 compatibility
- [ ] Consider deprecating `--surface-*` / `--text-*` custom properties (with `@deprecated` comments)

#### 5C: Toast System
- [ ] `bunx shadcn@latest add sonner`
- [ ] **Replace inline toast** in `TreeSidebar.tsx`
  - Current: `useState` + `setTimeout` for auto-dismiss
  - New: `toast()` from Sonner
- [ ] Add `<Toaster />` to `App.tsx` root
- [ ] Configure toast theme: dark, position (bottom-right), rich colors

#### 5D: Dead Code Removal
- [ ] Delete `hooks/useClickOutside.ts` (replaced by Radix)
- [ ] Delete `ui/ContextMenu.tsx` (replaced by shadcn ContextMenu)
- [ ] Delete `chat/CommandPalette.tsx` (replaced by shadcn Command)
- [ ] Delete `chat/GlobalCommandPalette.tsx` (replaced by shadcn Command)
- [ ] Remove manual `createPortal` calls (replaced by Radix)
- [ ] Remove custom scrollbar CSS (`::-webkit-scrollbar` blocks) if fully replaced by ScrollArea
- [ ] Clean up unused CSS custom properties

#### 5E: Animation & Micro-interactions
- [ ] Verify all shadcn enter/exit animations work correctly in Electron
- [ ] Add `tailwindcss-animate` plugin (required by shadcn)
  ```powershell
  bun add tailwindcss-animate
  ```
- [ ] Configure animation tokens in `index.css`
- [ ] Verify dialog open/close, dropdown expand/collapse, toast slide-in animations

#### 5F: Visual Polish Pass
- [ ] Compare pre-migration screenshots with post-migration
- [ ] Fix any visual regressions in:
  - Font sizes and line heights
  - Border radius consistency
  - Shadow depth
  - Spacing and padding
  - Color contrast ratios
- [ ] Ensure Electron frameless window drag regions still work with NavBar

**Exit Criteria:**
- Full keyboard-only navigation works
- No hand-rolled portal/positioning/click-outside code remains
- Sonner toasts working
- All animations smooth in Electron
- Visual parity with original design (or deliberate improvements documented)

---

### Phase 6: Testing, Documentation & Release (Days 36–42)
**Goal:** Validate everything works, document the new system, and prepare for merge.

#### 6A: Testing
- [ ] Run `bun run test` — all existing tests must pass
- [ ] Run `bun run lint` — no new warnings
- [ ] Run `bun run type-check` — zero errors
- [ ] Run `bun run package:local` — production build works
- [ ] Manual test matrix:
  - [ ] Chat: send message, receive streaming response, tool calls
  - [ ] Context menu: right-click on files, sessions, messages
  - [ ] Command palette: Ctrl+K, search, navigate, execute
  - [ ] Settings: toggle notifications, adjust volume, verify persistence
  - [ ] Git: open overlay, stage files, commit, branch switch
  - [ ] Sidebar: resize, expand/collapse, navigate projects/sessions
  - [ ] Dialogs: UIDialog from AI requests, confirmation dialogs
  - [ ] Welcome screen: keyboard shortcuts display, tips
  - [ ] Notifications: task complete, error, warning sounds
  - [ ] Window: minimize, maximize, close, drag (frameless)

#### 6B: Documentation
- [ ] Update `docs/research/shadcn-ui-research.md` with migration notes
- [ ] Create `docs/ui-component-guide.md`:
  - Which shadcn components are available
  - How to use `cn()` utility
  - CSS variable mapping (legacy → shadcn)
  - Component composition patterns
  - How to add new shadcn components (`bunx shadcn@latest add <component>`)
- [ ] Update `AGENTS.md` with shadcn conventions:
  - Always use shadcn primitives, never raw HTML elements for UI
  - Always use `cn()` for conditional classes
  - Always use `<Button>` instead of `<button>`
  - CSS variable mapping reference

#### 6C: Release Preparation
- [ ] Create feature branch: `feat/shadcn-migration`
- [ ] Squash or rebase commits for clean history
- [ ] Write comprehensive PR description with before/after screenshots
- [ ] Update `CHANGELOG.md` or equivalent
- [ ] Bump version if appropriate

**Exit Criteria:**
- All CI checks pass
- Manual test matrix 100% green
- Documentation complete
- PR ready for review

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tailwind v4 + shadcn CSS variables incompatibility | Medium | High | Phase 0 validates this first; shadcn Rhea supports Tailwind v4 |
| Electron renderer + Radix portal conflicts | Low | High | Test early in Phase 1; Radix uses `createPortal` which works in Electron |
| Focus trapping breaks in UIDialog | Low | Medium | Radix handles focus traps natively; verify with keyboard testing |
| Visual regression in dark-mode-only app | Medium | Medium | Screenshot comparison before/after each phase |
| Bundle size increase from Radix dependencies | Low | Low | Tree-shaking; each Radix package is ~5-15KB gzipped |
| Command palette keyboard nav regression | Medium | High | cmdk is the same library VS Code uses; extensive keyboard testing |
| Break existing IPC/hook integrations | Low | High | Migrate file-by-file; run full test suite after each file |

---

## Component Migration Priority Matrix

```
HIGH IMPACT + LOW EFFORT (Do First)
├── Button (used 40+ times, simple replacement)
├── Switch (1 component, 25 lines, direct swap)
├── Dialog (replaces manual portal, immediate accessibility win)
└── ContextMenu (replaces 135 lines of manual positioning)

HIGH IMPACT + HIGH EFFORT (Do Second)
├── Command (replaces 570 lines across 2 files)
├── Select (used in UIDialog forms)
├── Popover + Command combo for BranchSelector
└── Resizable (replaces 60 lines of drag handler)

LOW IMPACT + LOW EFFORT (Do Third)
├── Card (visual consistency)
├── Badge (visual consistency)
├── Separator (simple div replacement)
├── Tooltip (replaces title attributes)
└── ScrollArea (replaces custom CSS)

LOW IMPACT + HIGH EFFORT (Do Last)
├── Full CSS token migration (surface-* → shadcn vars)
├── Kbd component (custom, not in shadcn)
└── Animation polish pass
```

---

## File Change Estimate

| Phase | Files Modified | Files Created | Files Deleted |
|---|---|---|---|
| 0: Foundation | 3 | 3 | 0 |
| 1: Core Primitives | 12 | 4 | 1 |
| 2: Form & Input | 8 | 5 | 0 |
| 3: Navigation & Overlay | 10 | 5 | 2 |
| 4: Layout & Presentation | 8 | 7 | 0 |
| 5: Polish & Cleanup | 15 | 1 | 3 |
| 6: Testing & Docs | 5 | 2 | 0 |
| **Total** | **~61** | **~27** | **~6** |

---

## Dependencies Added

| Package | Size (gzipped) | Purpose |
|---|---|---|
| `@radix-ui/react-dialog` | ~12KB | Dialog/Modal primitive |
| `@radix-ui/react-popover` | ~8KB | Popover positioning |
| `@radix-ui/react-context-menu` | ~10KB | Right-click menu |
| `@radix-ui/react-dropdown-menu` | ~10KB | Dropdown menus |
| `@radix-ui/react-switch` | ~4KB | Toggle switch |
| `@radix-ui/react-slider` | ~6KB | Range slider |
| `@radix-ui/react-select` | ~12KB | Select dropdown |
| `@radix-ui/react-tooltip` | ~6KB | Tooltips |
| `@radix-ui/react-separator` | ~2KB | Dividers |
| `@radix-ui/react-scroll-area` | ~6KB | Custom scrollbars |
| `@radix-ui/react-tabs` | ~6KB | Tab navigation |
| `@radix-ui/react-slot` | ~1KB | Polymorphic component support |
| `class-variance-authority` | ~2KB | Variant styling |
| `clsx` | ~1KB | Class merging |
| `tailwind-merge` | ~5KB | Tailwind class conflict resolution |
| `lucide-react` | ~varies | Icon library (tree-shakeable) |
| `cmdk` | ~8KB | Command palette (used by shadcn Command) |
| `sonner` | ~6KB | Toast notifications |
| `tailwindcss-animate` | ~3KB | Animation utilities |
| **Total estimated** | **~100KB** | |

---

## Key Decisions Required

1. **CSS Token Strategy:** Should we keep the `--surface-*`/`--text-*` legacy tokens alongside shadcn tokens, or fully migrate to shadcn's `--background`/`--foreground` system?
   - **Recommendation:** Phase 0–4: Keep both (additive). Phase 5: Migrate to shadcn tokens exclusively.

2. **Light Mode:** shadcn assumes light/dark mode support. Should we add light mode or stay dark-only?
   - **Recommendation:** Stay dark-only for now. The CSS variables are structured to support light mode later without code changes.

3. **Icon Library:** shadcn uses `lucide-react` by default. NekoCode currently has custom `GitIcons.tsx` and inline SVGs. Should we migrate to Lucide?
   - **Recommendation:** Keep `GitIcons.tsx` (domain-specific). Use Lucide for generic icons (close, chevron, plus, minus, etc.). Migrate inline SVGs to Lucide gradually.

4. **Command Palette Library:** The research doc recommends `cmdk`. Should we use shadcn's `Command` component (which wraps cmdk)?
   - **Recommendation:** Yes. `bunx shadcn@latest add command` gives us the full cmdk-based component.

5. **Component Path:** shadcn defaults to `src/components/ui/`. NekoCode currently uses `src/renderer/src/components/ui/`. Should we align?
   - **Recommendation:** Yes, set `components.json` aliases to point to `src/renderer/src/components/ui/` for consistency with existing structure.

---

## Success Metrics

- ✅ Zero `createPortal` calls for UI overlays (Radix handles internally)
- ✅ Zero `useClickOutside` hook usages
- ✅ Zero raw `<button>` elements (all use `<Button>`)
- ✅ Zero raw `<input>` / `<textarea>` / `<select>` elements
- ✅ Zero manual `position: absolute` / `fixed` for dropdowns/menus
- ✅ 100% keyboard-navigable UI
- ✅ All form controls have proper `<Label>` associations
- ✅ All icon buttons have `<Tooltip>` instead of `title` attribute
- ✅ All CI checks pass (`bun run test`, `bun run lint`, `bun run type-check`, `bun run package:local`)
- ✅ Bundle size increase < 150KB gzipped
- ✅ No visual regressions in core workflows

---

*This plan is designed to be executed incrementally. Each phase is independently valuable — if work stops after Phase 2, the app already has better accessibility and maintainability. The phases are ordered by impact-to-effort ratio.*
