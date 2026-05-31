# shadcn/ui — Comprehensive Research Report for NekoCode

> **Date:** 2026-05-31 | **Source:** https://ui.shadcn.com/ | **Latest Version:** Rhea (2025)

---

## 1. What is shadcn/ui?

**shadcn/ui is NOT a traditional component library.** It is a **code distribution platform** and **design system framework** built on top of Radix UI primitives + Tailwind CSS. Unlike typical npm packages, shadcn/ui copies component **source code directly into your project** — you own the code, you modify the code, you control the code.

### Core Principles

| Principle | Description |
|---|---|
| **Open Code** | Component source code lives in YOUR project. Full transparency, full customization. No black-box dependencies. |
| **Composition** | Every component shares a common, composable interface. Predictable APIs across all components. |
| **Distribution** | Flat-file schema + CLI for distributing components across projects. Cross-framework support. |
| **Beautiful Defaults** | Carefully chosen default styles that look good out-of-the-box and work as a consistent system. |
| **AI-Ready** | Open code + consistent APIs make it easy for AI tools (like us!) to read, understand, and generate components. |

### Why This Matters for NekoCode

NekoCode currently has **ZERO Radix UI packages** installed. The `ContextMenu.tsx` is a hand-rolled implementation with manual positioning, manual event handling, and manual portal management. shadcn/ui would replace ALL of that boilerplate with battle-tested, accessible, Radix-powered primitives — **and you'd own the source code to customize them.**

---

## 2. Architecture Deep-Dive

### 2.1 Technology Stack

```
shadcn/ui
├── Radix UI Primitives (accessibility layer — keyboard nav, focus management, ARIA)
├── Tailwind CSS v4 (utility-first styling — CSS variables, @theme inline)
├── class-variance-authority (cva) — variant system for components
├── clsx + tailwind-merge → cn() utility for conditional class merging
└── Your Project (source code lives here, not in node_modules)
```

### 2.2 Two Base Options: `radix` vs `base`

shadcn/ui now supports **two primitive layers**:

| Feature | `radix` (Radix UI) | `base` (Headless) |
|---|---|---|
| Composition | `asChild` prop | `render` prop |
| Select | JSX-only items | `items` prop + multiple + object values |
| ToggleGroup | `type="single"/"multiple"` | `multiple` boolean |
| Slider | Always array `defaultValue={[50]}` | Scalar `defaultValue={50}` |
| Accordion | `type="single"/"multiple"` | `multiple` boolean |
| Multiple select | ❌ Not supported | ✅ Built-in |
| Object values | ❌ Not supported | ✅ Built-in via `itemToStringValue` |

**Recommendation for NekoCode:** Use the **`radix` base** — it's the most mature, best documented, and most widely used. The `base` option is newer and more flexible but less battle-tested.

### 2.3 Theming System

shadcn/ui uses **CSS variables** for theming with semantic token pairs:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
  /* Sidebar-specific tokens */
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  /* ... */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  /* Dark mode overrides */
}
```

**Convention:** Every token pair follows `name` / `name-foreground`. The base token is for backgrounds, `-foreground` is for text/icons on that surface.

**Radius Scale:** A single `--radius` token drives the entire border radius system:
- `radius-sm` = `calc(var(--radius) - 4px)`
- `radius-md` = `calc(var(--radius) - 2px)`
- `radius-lg` = `var(--radius)` (the base)
- `radius-xl` = `calc(var(--radius) + 4px)`

**NekoCode Mapping:** Your current `surface-*` and `text-*` custom tokens map directly to shadcn's semantic tokens:

| NekoCode Current | shadcn/ui Equivalent |
|---|---|
| `bg-surface-900` | `bg-background` (in dark mode) |
| `text-text-primary` | `text-foreground` |
| `text-text-secondary` | `text-muted-foreground` |
| `text-text-tertiary` | `text-muted-foreground` (lower opacity) |
| `bg-surface-800` | `bg-accent` |
| `border-surface-700` | `border-border` |
| `text-error` | `text-destructive` |

### 2.4 Dark Mode

Class-based toggle via `.dark` on the root element. For Vite projects (like NekoCode/electron-vite), use the Vite dark mode approach — add/remove the `dark` class on `<html>`.

---

## 3. Complete Component Catalog (60+ Components)

### 3.1 Form & Input (17 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Button** | Multiple variants (default, outline, ghost, destructive) | Chat send, Git actions, Settings |
| **Button Group** | Grouped buttons | Git action toolbars |
| **Input** | Text input with variants | Chat input, search, commit message |
| **Input Group** | Input with prefix/suffix addons | Search with icon, URL input |
| **Input OTP** | One-time password input | Auth flows |
| **Textarea** | Multi-line input | Chat input, commit messages |
| **Checkbox** | Checkbox input | Settings toggles |
| **Radio Group** | Radio button group | Settings options |
| **Select** | Dropdown select | Model selection, theme picker |
| **Native Select** | Styled HTML select | Simple selections |
| **Switch** | Toggle switch | Settings toggles (notifications, etc.) |
| **Slider** | Range slider | Font size, zoom level |
| **Calendar** | Date picker calendar | N/A currently |
| **Date Picker** | Input + calendar combo | N/A currently |
| **Combobox** | Searchable select with autocomplete | Command palette, model selection |
| **Label** | Form label | Settings form labels |
| **Field** | Field wrapper with label + description + validation | All form inputs |

### 3.2 Layout & Navigation (8 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Accordion** | Collapsible sections | Settings sections, sidebar sections |
| **Breadcrumb** | Breadcrumb navigation | File path display |
| **Navigation Menu** | Accessible nav with dropdowns | NavBar menus |
| **Sidebar** | Collapsible sidebar layout | **TreeSidebar replacement!** |
| **Tabs** | Tabbed interface | Git tabs, settings tabs |
| **Separator** | Visual divider | Between sections |
| **Scroll Area** | Custom styled scrollbars | Chat messages, file tree |
| **Resizable** | Resizable panel layout | Split panes (chat + diff) |

### 3.3 Overlays & Dialogs (8 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Dialog** | Modal dialog | Settings modal, confirmation dialogs |
| **Alert Dialog** | Confirmation prompt | Destructive action confirmations |
| **Sheet** | Slide-out panel | Settings panel, notifications |
| **Drawer** | Mobile-friendly bottom sheet | Notification drawer |
| **Popover** | Floating popover | Tooltips with content, date pickers |
| **Tooltip** | Hover tooltip | Button hints, icon labels |
| **Hover Card** | Card on hover | User profiles, file info |
| **Context Menu** | Right-click menu | **Direct replacement for current ContextMenu.tsx!** |

### 3.4 Menus & Commands (4 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Dropdown Menu** | Dropdown menu | NavBar menus, action menus |
| **Context Menu** | Right-click menu | File tree, chat messages |
| **Menubar** | Horizontal menu bar | App-level menu (File, Edit, View) |
| **Command** | Command palette (cmdk) | **Direct replacement for GlobalCommandPalette!** |

### 3.5 Feedback & Status (8 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Alert** | Alert/notification box | Error messages, warnings |
| **Toast / Sonner** | Toast notifications | Operation feedback, errors |
| **Progress** | Progress bar | Loading, streaming progress |
| **Spinner** | Loading spinner | Loading states |
| **Skeleton** | Loading placeholder | Chat message loading |
| **Badge** | Status label | Git status, model badges |
| **Empty** | Empty state | No sessions, no files |
| **Kbd** | Keyboard shortcut display | Command palette shortcuts |

### 3.6 Display & Media (8 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Avatar** | User profile image | AI provider avatars |
| **Card** | Content container | Message cards, settings sections |
| **Table** | Data table | Staging area, diff stats |
| **Data Table** | Advanced table with sort/filter/pagination | Git log, file lists |
| **Chart** | Recharts wrapper | Usage stats (if needed) |
| **Carousel** | Image/content carousel | N/A currently |
| **Aspect Ratio** | Maintain aspect ratio | N/A currently |
| **Typography** | Text styles | Markdown content, headings |
| **Item** | Generic list/menu item | List items |

### 3.7 Misc (4 components)

| Component | Description | NekoCode Use Case |
|---|---|---|
| **Collapsible** | Collapsible container | Thinking blocks, tool call details |
| **Toggle** | Toggle button | Bold/italic in markdown, view toggles |
| **Toggle Group** | Grouped toggles | View mode selection |
| **Pagination** | Page navigation | Long lists |

---

## 4. CLI & Workflow

### 4.1 Installation (for Vite/electron-vite)

```bash
# Initialize shadcn/ui in existing project
bunx --bun shadcn@latest init

# Or with a preset
bunx --bun shadcn@latest init --preset nova
```

This creates:
- `components.json` — Configuration file
- `src/renderer/src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- CSS variables in your global CSS
- Path aliases in tsconfig

### 4.2 Adding Components

```bash
# Add individual components
bunx --bun shadcn@latest add button dialog context-menu

# Add all components
bunx --bun shadcn@latest add --all

# Preview before adding
bunx --bun shadcn@latest add button --dry-run
bunx --bun shadcn@latest add button --diff button.tsx
```

### 4.3 Presets

Named presets: **nova**, **vega**, **maia**, **lyra**, **mira**, **luma**

```bash
# Apply a preset theme
bunx --bun shadcn@latest apply nova

# Apply only theme (not components)
bunx --bun shadcn@latest apply nova --only theme

# Build a preset visually at https://ui.shadcn.com/create
```

### 4.4 Key CLI Commands

| Command | Purpose |
|---|---|
| `shadcn init` | Initialize config and dependencies |
| `shadcn add <component>` | Add component source code to project |
| `shadcn apply <preset>` | Apply a preset theme |
| `shadcn search <query>` | Search registries for components |
| `shadcn view <component>` | Preview registry items |
| `shadcn docs <component>` | Get docs and example URLs |
| `shadcn migrate radix` | Migrate from @radix-ui/* to unified radix-ui |
| `shadcn info` | Show project configuration |

---

## 5. NekoCode Migration Analysis

### 5.1 Current State

| Aspect | Current NekoCode | With shadcn/ui |
|---|---|---|
| **UI Framework** | Hand-rolled components | Radix-powered accessible primitives |
| **Component Count** | 4 custom UI components (ContextMenu, WelcomeScreen, NotificationSettings*) | 60+ production-grade components |
| **Radix Packages** | **NONE** installed | Radix UI via shadcn/ui |
| **CSS Variables** | Custom `surface-*`, `text-*` tokens | Standard semantic tokens (`background`, `foreground`, `primary`, etc.) |
| **Dark Mode** | Custom implementation | Built-in via `.dark` class toggling |
| **Accessibility** | Manual ARIA (if any) | Radix provides full keyboard nav + ARIA out-of-box |
| **Variants** | Manual className strings | `cva` variant system |
| **Class Merging** | Manual string concatenation | `cn()` utility (clsx + tailwind-merge) |

### 5.2 Direct Component Replacements

| Current NekoCode Component | shadcn/ui Replacement | Effort |
|---|---|---|
| `ContextMenu.tsx` (170 lines, hand-rolled) | `ContextMenu` from shadcn | **Easy** — drop-in, same API concept, better a11y |
| `GlobalCommandPalette.tsx` | `Command` (cmdk-based) | **Medium** — need to adapt command structure |
| `NotificationSettings*` | `Sheet` + form components | **Medium** — would benefit from shadcn form patterns |
| `WelcomeScreen` | `Card` + custom content | **Easy** — styling upgrade |
| Custom modal/overlay logic | `Dialog`, `Sheet`, `Drawer` | **Easy** — Radix handles portals, focus traps, etc. |

### 5.3 New Capabilities Unlocked

| Component | NekoCode Use Case |
|---|---|
| **Sidebar** | Proper collapsible TreeSidebar with keyboard nav |
| **Tabs** | Git view tabs, settings sections |
| **Scroll Area** | Custom scrollbars in chat and file tree |
| **Resizable** | Split panes between chat and diff views |
| **Toast/Sonner** | Operation feedback (git push, file save, errors) |
| **Tooltip** | Icon button hints throughout the UI |
| **Dropdown Menu** | NavBar menus, branch selector, model selector |
| **Select/Combobox** | Model selection with search |
| **Dialog** | Proper modal dialogs with focus trapping |
| **Badge** | Git status indicators, provider badges |
| **Skeleton** | Chat loading placeholders |
| **Alert** | Error/warning displays |
| **Accordion** | Settings sections, collapsible tool calls |
| **Progress** | Streaming progress, loading indicators |

### 5.4 Migration Path (Recommended)

**Phase 1: Foundation (Low Risk)**
1. Run `bunx --bun shadcn@latest init` with `--preset` that matches NekoCode's dark theme
2. Map existing `surface-*` / `text-*` CSS variables to shadcn semantic tokens
3. Add `cn()` utility and start using it in new code
4. Add components that DON'T replace existing ones: `Tooltip`, `Badge`, `Separator`, `Skeleton`

**Phase 2: Replace Hand-Rolled Components (Medium Risk)**
5. Replace `ContextMenu.tsx` with shadcn `ContextMenu`
6. Replace `GlobalCommandPalette` with shadcn `Command` component
7. Add `Dialog` for modal needs
8. Add `Sheet` for slide-out panels
9. Add `ScrollArea` for chat and sidebar

**Phase 3: Build New Features with shadcn (Low Risk)**
10. Build settings UI with shadcn `Tabs`, `Card`, `Switch`, `Select`
11. Build Git interface with shadcn `Tabs`, `Table`, `Badge`, `DropdownMenu`
12. Build sidebar with shadcn `Sidebar` component
13. Add `Resizable` for split-pane layouts

**Phase 4: Polish & Consistency**
14. Replace all `surface-*`/`text-*` classes with semantic shadcn tokens
15. Add proper dark mode toggling via `.dark` class
16. Apply a consistent preset theme

### 5.5 Risks & Considerations

| Risk | Mitigation |
|---|---|
| **Bundle size** — Adding many Radix packages | shadcn adds components individually. Only install what you use. Radix primitives are tree-shakeable. |
| **CSS variable collision** — Existing custom tokens | Map existing tokens to shadcn equivalents. Can coexist during migration. |
| **Electron/Vite compatibility** — SSR concerns | shadcn/ui is client-only. NekoCode's renderer is a browser window — no SSR issues. ✅ |
| **Tailwind v4** — NekoCode uses TW v4 | shadcn/ui fully supports Tailwind v4 with `@theme inline` blocks. ✅ |
| **Learning curve** — New component APIs | shadcn provides consistent, composable APIs. Local skill file has detailed rules. |
| **Breaking changes** — Component updates | You own the source code. Updates are opt-in via CLI. Pin versions if needed. |
| **electron-vite path aliases** — May need adjustment | shadcn init configures `@/*` aliases. May need to adapt for electron-vite's structure. |

---

## 6. Key shadcn/ui Rules (from Local Skill)

### 6.1 Styling Rules
- **`className` for layout, not styling** — Never override component colors/typography
- **No `space-x-*` or `space-y-*`** — Use `flex` with `gap-*`
- **Use `size-*` for equal width/height** — `size-10` not `w-10 h-10`
- **No manual `dark:` color overrides** — Use semantic tokens
- **Use `cn()` for conditional classes** — No template literal ternaries
- **No manual `z-index` on overlays** — Dialog, Sheet, Popover handle their own stacking

### 6.2 Form Rules
- **Forms use `FieldGroup` + `Field`** — Never raw `div` with `space-y-*`
- **`InputGroup` uses `InputGroupInput`** — Not raw `Input` inside `InputGroup`
- **Validation uses `data-invalid` + `aria-invalid`** — On `Field` and control respectively

### 6.3 Composition Rules
- **Items always inside their Group** — `SelectItem` → `SelectGroup`
- **Dialog, Sheet, Drawer always need a Title** — Use `className="sr-only"` if visually hidden
- **Use full Card composition** — `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`
- **Icons in Button use `data-icon`** — `data-icon="inline-start"` or `"inline-end"`

---

## 7. Comparison: Raw Radix UI vs shadcn/ui

| Aspect | Raw Radix UI | shadcn/ui |
|---|---|---|
| **Installation** | `npm install @radix-ui/react-dialog @radix-ui/react-popover ...` (per-package) | `bunx shadcn add dialog popover` (source code copied) |
| **Styling** | Unstyled. You write all Tailwind classes yourself | Pre-styled with beautiful defaults + variants via `cva` |
| **Accessibility** | ✅ Built-in | ✅ Built-in (inherits from Radix) |
| **Customization** | Full control from scratch | Full control (you own the source code) |
| **Variant System** | Roll your own | `cva` + `variant` props built-in |
| **Dark Mode** | Manual | CSS variable tokens with `.dark` class |
| **Code Location** | `node_modules/@radix-ui/*` | `src/components/ui/*` (your project) |
| **Updates** | `npm update` | `bunx shadcn add button --diff` (opt-in per component) |
| **Learning Curve** | High — need to style everything | Low — beautiful defaults, just customize as needed |
| **AI Friendliness** | Low — generic primitives | High — consistent API, open code, AI-ready design |
| **Package Count** | ~30+ individual `@radix-ui/*` packages | 1 `shadcn` CLI + selected Radix primitives as deps |

---

## 8. Summary & Recommendation

### Why shadcn/ui is Perfect for NekoCode

1. **Zero Lock-in:** Component source code lives in YOUR project. No dependency hell. Fork, modify, extend freely.

2. **Massive Component Library:** 60+ production-grade components vs. the 4 hand-rolled ones currently in NekoCode. Immediate access to: Command palette, Sidebar, Dialog, Sheet, Context Menu, Scroll Area, Resizable panels, Toast notifications, and much more.

3. **Built on Radix UI:** Full accessibility out-of-the-box — keyboard navigation, focus management, ARIA attributes. The current `ContextMenu.tsx` is 170 lines of manual DOM manipulation that Radix handles for free.

4. **Tailwind v4 Compatible:** NekoCode already uses Tailwind v4. shadcn/ui fully supports it with `@theme inline` blocks.

5. **Dark Mode Built-in:** Semantic CSS variable tokens with `.dark` class toggling. Maps cleanly to NekoCode's existing dark theme.

6. **Vite Compatible:** Full Vite installation guide. electron-vite is Vite-based, so this works.

7. **AI-Ready:** The entire design is optimized for AI tools to read, understand, and generate components. Perfect for our development workflow.

8. **Incremental Adoption:** Add one component at a time. No big-bang migration needed. Existing components can coexist with shadcn components during transition.

9. **Active Development:** The "Rhea" release is the latest. The project is extremely active with new components, presets, and features shipping regularly.

10. **Bun Compatible:** `bunx --bun shadcn@latest` works perfectly with NekoCode's Bun package manager.

### Immediate Next Steps

If you want to proceed, I recommend:
1. Run `bunx --bun shadcn@latest init` to set up the foundation
2. Choose a preset that matches NekoCode's dark aesthetic
3. Add the `ContextMenu` component first (direct replacement for the hand-rolled one)
4. Add `Command` for the command palette
5. Incrementally add more components as needed

This research was compiled from:
- Official shadcn/ui website (scraped via Firecrawl)
- Official documentation (Introduction, Installation, Theming, CLI, Registry)
- llms.txt machine-readable summary
- Local `.agents/skills/shadcn/SKILL.md` and associated rule files
- NekoCode's current package.json and source code analysis
