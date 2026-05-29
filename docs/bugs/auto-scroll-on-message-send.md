# Bug: Chat doesn't auto-scroll when user sends a message

## Date
2026-05-29

## Description
When a user sends a message in the chat, the message list does not automatically scroll down to show the newly sent message. The user has to either manually scroll down or click the "scroll to bottom" button to see their message and the AI's response.

## Root Cause
In `src/renderer/src/components/chat/MessagesTimeline.tsx`, the `followOutput` prop on the Virtuoso component was set conditionally:

```tsx
followOutput={isStreaming ? 'smooth' : false}
```

This meant Virtuoso only auto-scrolled when `isStreaming` was `true` (i.e., when the AI was actively streaming a response). When the user sends a message, `isStreaming` is still `false` — the AI response hasn't started streaming yet — so Virtuoso's `followOutput` was `false`, preventing auto-scroll.

The gap between the user pressing Enter and the AI starting to stream was the problem window. During this time, the user's message appears at the bottom of the list but the view doesn't scroll down to show it.

## Fix
Changed `followOutput` to always be `'smooth'`:

```tsx
followOutput='smooth'
```

Virtuoso's `followOutput='smooth'` already handles the smart behavior:
- If the user is near the bottom of the list, it auto-scrolls smoothly to show new content
- If the user has scrolled up to read older messages, it respects their position and does NOT force-scroll them back down

This means auto-scroll now works both when the user sends a message AND during AI streaming, while still respecting the user's scroll position when they've deliberately scrolled up.

## Files Changed
- `src/renderer/src/components/chat/MessagesTimeline.tsx`
  - Changed `followOutput={isStreaming ? 'smooth' : false}` to `followOutput='smooth'`
  - Removed `isStreaming` from props destructuring (no longer needed inside the component, but kept in the interface for API compatibility)
  - Updated docstring comment to reflect the new behavior

## Testing
- Type-check passes with no new errors
- Lint passes with no new errors
- Manual testing: sending a message now auto-scrolls to show the new user message, and the AI response streaming continues to auto-scroll as before
