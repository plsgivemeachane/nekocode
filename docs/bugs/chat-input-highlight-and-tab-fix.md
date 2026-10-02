# Bug: Text Selection Highlight with Border Radius & Broken Arrow Key Navigation in Command Palette

**Date:** 2026-06-08
**Status:** Fixed
**Files Modified:**
- `src/renderer/src/components/chat/ChatInput.tsx`
- `src/renderer/src/components/chat/CommandPalette.tsx`
- `src/tests/renderer/CommandPalette.test.tsx`

---

## Bug 1: Text Selection Highlight Has Border Radius in Chat Input

### Description
When selecting/highlighting text in the chat input textarea, the selection highlight appeared with rounded corners instead of the normal rectangular selection shape. This looked visually broken and out of place.

### Root Cause
The shadcn/ui `Textarea` base component (`src/renderer/src/components/ui/textarea.tsx`) includes `rounded-md` in its default class list. The `ChatInput` component did not override this with a `rounded-none` class. Since the textarea element itself had `border-radius: 0.375rem`, the browser applied that border-radius to the text selection highlight, making the selected text appear with rounded corners.

Additionally, `tailwind-merge` v3.6.0 does not properly resolve some Tailwind v4 utility conflicts (e.g., `field-sizing-content` vs `field-sizing-none`, `focus-visible:ring-[3px]` vs `focus-visible:ring-0`), so both conflicting classes can appear in the final merged output. The CSS source-order winner determines which style applies.

### Fix
Added `rounded-none` to the Textarea className in ChatInput to explicitly override the base `rounded-md`:

```tsx
<Textarea
  className="... rounded-none ..."
/>
```

This removes the border-radius from the textarea element, so the text selection highlight renders as a normal rectangle.

---

## Bug 2: Arrow Keys Not Navigating Command Palette & Tab Key Switching Focus

### Description
When the slash command palette was visible:
1. Pressing ArrowUp/ArrowDown did not navigate the command list — the cursor moved in the textarea instead.
2. Pressing Tab moved focus to the model selection button instead of autocompleting the highlighted command.

### Root Cause
The chat textarea captures keyboard focus. The cmdk library (v1.1.1) handles keyboard navigation via an `onKeyDown` handler on its `[cmdk-root]` container element. Since focus remains on the textarea, cmdk never receives arrow key, Enter, or Tab events.

The previous code assumed cmdk used a "document-level listener" for keyboard events, but this was incorrect — cmdk only listens on its own root element. The `handleKeyDown` callback in ChatInput would just `return` for these keys without forwarding them to cmdk.

### Fix
When the command palette is visible:

**Arrow keys + Enter:** Dispatch a synthetic `KeyboardEvent` on the `[cmdk-root]` element so cmdk handles navigation and selection natively:

```typescript
const cmdkRoot = document.querySelector('[cmdk-root]')
if (cmdkRoot) {
  const syntheticEvent = new KeyboardEvent('keydown', {
    key: e.key,
    code: e.code,
    bubbles: true,
    cancelable: true,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
  })
  cmdkRoot.dispatchEvent(syntheticEvent)
}
```

**Tab key:** cmdk doesn't natively handle Tab. Instead, find the currently selected item via `[data-selected="true"]` and click it:

```typescript
e.preventDefault()
const selected = document.querySelector('[cmdk-root] [data-selected="true"]')
if (selected) selected.click()
```

Also call `e.preventDefault()` for all palette navigation keys to prevent the browser's default behavior (cursor movement in textarea, focus shift on Tab, newline on Enter).

Added "tab select" hint to the CommandPalette footer to indicate Tab can be used for selection.

### Test Update
Updated `CommandPalette.test.tsx` to use more specific regex `/↵ select/` instead of `/select/` since the footer now contains both "↵ select" and "tab select".
