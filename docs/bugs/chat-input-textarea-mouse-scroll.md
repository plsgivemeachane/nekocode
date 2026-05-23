# ChatInput Textarea Cannot Scroll with Mouse Wheel

## Date
2025-05-23

## Bug Description
The main user input textarea in NekoCode could not be scrolled using the mouse wheel when the text content exceeded the visible area. Scrolling only worked via keyboard arrow keys.

## Root Cause
The textarea element had `overflow-hidden` in its CSS class:

```tsx
<textarea
  className="... overflow-hidden ..."
/>
```

`overflow: hidden` clips content that overflows the element box and removes scroll behavior entirely. While keyboard arrow keys still work (they move the cursor/selection, and the browser auto-scrolls the textarea view to keep the cursor visible), the mouse wheel has no effect because there is no scroll container.

## Fix
Changed `overflow-hidden` to `overflow-y-auto`:

```tsx
// Before
className="... overflow-hidden ..."

// After
className="... overflow-y-auto ..."
```

`overflow-y-auto` allows vertical scrolling when content overflows, and automatically shows a scrollbar. When content fits within the textarea, no scrollbar appears (same visual behavior as before). When content overflows, the user can scroll with the mouse wheel.

The textarea already has `resize-none` to prevent manual resizing, and the JavaScript auto-height logic in `handleInputChange` caps the height at `TEXTAREA_MAX_HEIGHT_PX`. Once that cap is reached, overflow-y scrolling takes over.

## Files Changed
- `src/renderer/src/components/chat/ChatInput.tsx` — Line 178: Changed `overflow-hidden` to `overflow-y-auto` in textarea className

## Testing
- All 1390 tests pass
- Type-check passes
- Lint passes
