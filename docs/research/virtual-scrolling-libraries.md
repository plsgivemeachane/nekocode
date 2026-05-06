# Virtual Scrolling Library Research for NekoCode

> **Date:** 2026-05-06  
> **Context:** Evaluating npm packages to replace the broken `@tanstack/react-virtual` implementation in `MessagesTimeline.tsx`

---

## Current Implementation (Why It's Broken)

NekoCode's `MessagesTimeline.tsx` uses **`@tanstack/react-virtual`** with a hybrid approach:

- **Virtualized prefix**: Older messages rendered via `useVirtualizer` with `measureElement` + a custom `ResizeObserver` workaround
- **Unvirtualized live tail**: Last 24-48 rows rendered as plain DOM (to avoid virtualization glitches during streaming)

This hybrid is fragile because:

1. The "live tail" boundary creates a visual seam — switching from absolute-positioned virtualized rows to normal-flow rows causes layout jumps
2. `measureElement` requires a two-pass render (estimate -> render -> measure -> reposition), causing items to visually "jump" on first appearance
3. The custom `ResizeObserver` + image `load` event listener is manual glue code that `@tanstack/react-virtual` should handle but doesn't for dynamic content
4. No built-in auto-scroll-to-bottom during streaming — that logic lives elsewhere and fights with the virtualizer
5. No prepend support (loading older messages causes scroll jumps)

---

## Candidates Evaluated

### 1. react-virtuoso — RECOMMENDED

| Attribute | Value |
|---|---|
| **npm package** | `react-virtuoso` |
| **Weekly downloads** | ~2.1M |
| **Latest version** | 4.12.x |
| **Bundle size** | ~17KB gzipped |
| **Dependencies** | Zero |
| **Last updated** | Active (2024-2026) |
| **License** | MIT |

**Why it wins for NekoCode:**

- **Built-in chat mode**: `followOutput="smooth"` auto-scrolls during streaming, `atBottomStateChange` detects scroll position, `initialTopMostItemIndex` starts at bottom — all first-class APIs, no glue code
- **Prepend without jump**: `firstItemIndex` seamlessly handles loading older messages at the top without scroll position disruption
- **Dynamic heights automatic**: ResizeObserver-based measurement handles markdown rendering, code blocks, tool call expand/collapse — zero manual measurement code
- **Kills the hybrid pattern entirely**: No need for the "unvirtualized live tail" hack. react-virtuoso handles streaming inserts natively
- **Proven in production**: Used by **Rocket.Chat** for their message list (the hardest virtualization use case — bi-directional loading + dynamic heights + sticky date separators)
- **GroupedVirtuoso**: Built-in sticky group headers if NekoCode ever adds date separators

**Example for NekoCode's use case:**

    import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

    <Virtuoso
      ref={virtuosoRef}
      data={messages}
      followOutput="smooth"
      atBottomStateChange={(atBottom) => setAtBottom(atBottom)}
      initialTopMostItemIndex={messages.length - 1}
      startReached={loadOlderMessages}
      itemContent={(_, message) => <MessageComponent message={message} />}
    />

---

### 2. virtua — STRONG ALTERNATIVE

| Attribute | Value |
|---|---|
| **npm package** | `virtua` |
| **Weekly downloads** | ~566K |
| **Latest version** | 0.49.1 (published 24 days ago) |
| **Bundle size** | **~3KB gzipped** (smallest) |
| **Dependencies** | Zero |
| **License** | MIT |

**Strengths:**

- **Smallest bundle** by far (3KB vs 17KB vs 5KB) — tree-shakeable per component
- **Zero-config**: Drop-in `<VList>` component, no setup
- **Reverse scroll built-in**: Native bottom-up scrolling for chat
- **Bi-directional infinite scroll**: Built-in, no extra code
- **Framework agnostic**: React, Vue, Solid, Svelte bindings
- **Actively maintained**: 191 versions, published 24 days ago
- **iOS Safari reverse scroll support**: Only library that even attempts this

**Weaknesses vs react-virtuoso:**

- No `followOutput` equivalent — auto-scroll during streaming needs manual implementation
- No `firstItemIndex` — prepend (loading older messages) needs manual scroll offset math
- No sticky group headers
- Smaller community (79 dependents vs react-virtuoso's much larger ecosystem)
- Newer project with less production battle-testing for chat specifically

**Example:**

    import { VList } from 'virtua'

    <VList style={{ height: '100%' }}>
      {messages.map((msg) => <MessageComponent key={msg.id} message={msg} />)}
    </VList>

---

### 3. @tanstack/react-virtual — WHAT YOU ALREADY HAVE

| Attribute | Value |
|---|---|
| **npm package** | `@tanstack/react-virtual` |
| **Weekly downloads** | ~1.3M |
| **Latest version** | 3.13.x |
| **Bundle size** | ~5KB gzipped |
| **Dependencies** | Zero |

**Why NOT to stay with it:**

- **Headless = you build everything**: No auto-scroll, no follow-output, no prepend handling, no chat mode — all the glue code in `MessagesTimeline.tsx` exists *because* of this
- **Two-pass measurement**: Items jump visually on first render when estimate != actual height
- The current implementation already demonstrates the pain: 90 lines of manual ResizeObserver workarounds, image load event listeners, hybrid unvirtualized tail pattern — all things react-virtuoso gives you for free

**When it IS the right choice:** Data tables paired with `@tanstack/react-table`, drag-and-drop sortable lists with `@dnd-kit`, or when you need absolute control over every pixel. Not chat.

---

### 4. react-window — DISQUALIFIED

| Attribute | Value |
|---|---|
| **npm package** | `react-window` |
| **Weekly downloads** | ~1.9M (legacy inertia) |
| **Latest version** | 1.8.10 (2019) |
| **Bundle size** | ~6KB gzipped |

**Dead project.** Last real update was 2019. Fixed-height only — `VariableSizeList` requires you to know all heights upfront synchronously, which is impossible for chat messages with markdown, code blocks, and tool calls. The maintainer has explicitly stated no new features are coming. The high download count is entirely from existing projects that haven't migrated yet.

---

## Summary Comparison

| Feature | react-virtuoso | virtua | @tanstack/react-virtual | react-window |
|---|---|---|---|---|
| **Dynamic heights** | Auto | Auto | Manual (measureElement) | Pre-measure only |
| **Chat auto-scroll** | `followOutput` | Manual | Manual | None |
| **Prepend (load older)** | `firstItemIndex` | Manual | Manual | None |
| **Reverse scroll** | Native | Native | None | None |
| **Streaming inserts** | Smooth follow | Manual | Manual | None |
| **Bundle size** | 17KB | **3KB** | 5KB | 6KB |
| **Active maintenance** | Yes | Yes | Yes | No (archived) |
| **Chat production use** | Rocket.Chat | Limited | DIY | None |
| **Glue code needed** | None | Moderate | Heavy | Extreme |

---

## Final Recommendation

**Primary choice: `react-virtuoso`** — It eliminates the entire hybrid virtualized/unvirtualized pattern, removes all the ResizeObserver workaround code, and gives you chat-specific APIs (`followOutput`, `startReached`, `firstItemIndex`) that directly address every broken behavior in the current implementation. The 17KB bundle cost is justified by deleting ~90 lines of manual glue code and getting a battle-tested chat scrolling solution.

**Runner-up: `virtua`** — If bundle size is a hard constraint and you're willing to implement auto-scroll and prepend logic manually, virtua gives you the smallest footprint (3KB) with solid dynamic height support and reverse scrolling. It's the most promising rising star in this space.

**Install:**

    bun add react-virtuoso

---

## Sources

- PkgPulse — "TanStack Virtual vs react-window vs react-virtuoso 2026" (pkgpulse.com, March 2026)
- npm — `react-virtuoso` package page
- npm — `virtua` package page (v0.49.1)
- npm — `@tanstack/react-virtual` package page
- npm — `react-window` package page
- virtua README — Comparison table (github.com/inokawa/virtua)
- Kreya Blog — "Virtual Scrolling: Rendering millions of messages without lag" (kreya.app, March 2026)
- Reddit r/reactjs — "Chat-style virtual scrolling (bottom-up), which npm package?"
- npmtrends — Download trend comparison
