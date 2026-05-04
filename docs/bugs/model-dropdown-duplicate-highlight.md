# Bug: Model Dropdown Highlights Multiple Models with Same Name

## Date
2026-05-04

## Severity
Low (UI glitch)

## Component
`src/renderer/src/components/chat/ChatInput.tsx`

## Description
When the model dropdown is opened and the available model list contains two models that share the same `id` (e.g., `gpt-4o` available via both `openai` and `openrouter` providers), both entries are highlighted with the active accent color simultaneously. Only the model that is actually active for the current session should be highlighted.

## Root Cause
Two issues in the model dropdown rendering within `ChatInput.tsx`:

1. **Highlighting logic compared only model ID**: The conditional class `activeModel?.id === m.id` did not also check `activeModel?.provider === m.provider`. Since the dropdown filters out native providers (anthropic, google, openai), third-party providers that offer the same model ID (e.g., openrouter offering `gpt-4o`) would both match the highlight condition.

2. **Non-unique React key**: The `key={m.id}` prop on the mapped model buttons would produce duplicate keys when two models share the same ID, causing React reconciliation issues.

## Fix
- Changed `key={m.id}` to `key={\`${m.provider}:${m.id}\`}` to ensure uniqueness per provider+model combination.
- Changed the highlight condition from `activeModel?.id === m.id` to `activeModel?.id === m.id && activeModel?.provider === m.provider` so only the exact active model (matching both ID and provider) is highlighted.

## Files Changed
- `src/renderer/src/components/chat/ChatInput.tsx` (2 line changes)

## Verification
- All existing tests pass (`bun run test`)
- Lint passes (`bun run lint`)
- Type-check passes (`bun run type-check`)
