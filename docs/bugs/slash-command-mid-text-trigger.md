# Slash Command Triggers in Middle of Text Instead of Only at Start

**Date:** 2026-05-17
**Severity:** Medium (UX bug - incorrect behavior)
**File:** `src/renderer/src/components/chat/ChatInput.tsx`

## Bug Description

Slash commands (e.g., `/help`, `/clear`) were being triggered when the `/` character appeared anywhere in the input text, not just at the very beginning. For example, typing "hello /help" would show the command palette and allow command selection, even though slash commands should only be recognized when they are the first non-whitespace content in the input.

The expected behavior is:
- `/help` → triggers command palette, selects the `/help` command
- "hello /help" → does NOT trigger command palette, the text is sent as plain input

## Root Cause

Three functions in `ChatInput.tsx` were using `lastIndexOf(' ')` to find the "last word" starting with `/`, which incorrectly matched slashes anywhere in the text:

1. **`getCommandQuery` (line ~93):** Used `text.lastIndexOf(' ')` to find the last word, then checked if it started with `/`. This meant "hello /abc" would extract "abc" as a command query.

2. **`handleInputChange` (line ~168):** Used the same `lastIndexOf(' ')` pattern to decide whether to show the command palette. Any word starting with `/` would trigger it, regardless of position.

3. **`handleCommandSelect` (line ~102):** When a command was selected from the palette, it replaced only the `/command` fragment using `input.lastIndexOf(' ')`, preserving any text before the space. This meant selecting a command from "hello /help" would result in "hello /actual-command ".

## Fix

Changed all three locations to only recognize slash commands at the start of the input:

1. **`getCommandQuery`:** Now uses `text.trimStart().startsWith('/')` to only match when the slash is at the beginning of the input (after leading whitespace).

2. **`handleInputChange`:** Now uses `value.trimStart().startsWith('/')` to only show the command palette when the slash is the first non-whitespace character.

3. **`handleCommandSelect`:** Now replaces the entire input with `/${command.name} ` instead of preserving preceding text, since commands are always start-of-input.

Also removed `input` from the `handleCommandSelect` dependency array since it is no longer referenced in the callback body.

## Verification

- All 846 existing tests pass
- TypeScript type-check passes
- ESLint passes
