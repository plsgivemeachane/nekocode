# StatusIndicator Disconnected from Message Box After Virtuoso Migration

**Date:** 2026-05-06  
**Severity:** UI/UX  
**Component:** ChatView, StatusIndicator, MessagesTimeline  

## Problem

After migrating `MessagesTimeline` from a manual scroll container to `react-virtuoso`, the `StatusIndicator` component became visually disconnected from the message input area.

Previously, `StatusIndicator` was rendered inside the same flex column as the messages, sitting between `MessagesTimeline` and the bottom of the container. With Virtuoso managing its own scroll container (via `flex-1 min-h-0`), the `StatusIndicator` was pushed to the very bottom of the available space — far below the last message and visually separated from the input box.

This created a poor UX where the status line (model name, token usage, cost, context %, elapsed time, ready/working state) floated in empty space rather than being anchored near the input area where the user's attention is focused.

## Fix

Moved `StatusIndicator` out of the Virtuoso flex container and placed it just above the `ChatInput` component in `ChatView.tsx`.

### Before (inside Virtuoso container):
```tsx
<div className="max-w-3xl mx-auto pt-4 h-full flex flex-col">
  <div className="flex-1 min-h-0">
    <MessagesTimeline ... />
  </div>
  <StatusIndicator ... />  {/* ← disconnected from input */}
</div>
```

### After (above ChatInput):
```tsx
{/* Messages area — Virtuoso fills remaining space */}
<div className="max-w-3xl mx-auto pt-4 h-full flex flex-col">
  <div className="flex-1 min-h-0">
    <MessagesTimeline ... />
  </div>
</div>

{/* StatusIndicator anchored above input */}
{messages.length > 0 && (
  <div className="px-6 pb-1">
    <div className="max-w-3xl mx-auto">
      <StatusIndicator ... />
    </div>
  </div>
)}

<ChatInput ... />
```

## Result

The `StatusIndicator` is now visually attached to the input area, always visible at the bottom of the viewport regardless of message scroll position. It only appears when messages exist (`messages.length > 0`), matching the previous behavior.
