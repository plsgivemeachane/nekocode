# Configured providers hidden from model selection

## Symptom

The chat input model dropdown showed “No models configured” when only OpenAI,
Anthropic, or Google models were available. When other providers were configured,
those three providers were still absent, so users could not select their models.

## Cause

`ChatInput.tsx` filtered the result of `session.listModels()` against a hardcoded
list of provider IDs (`anthropic`, `google`, and `openai`). The main process already
uses `modelRuntime.getAvailable()` to return models with valid credentials. The
renderer applied an additional exclusion that hid valid choices.

## Change

The new `ModelSelector.tsx` displays every model returned by the backend, grouped
by its actual provider. A left sidebar lists provider names, icons, and model counts. The right pane
shows only models from the selected provider; search matches model names and IDs
within that provider. Opening the picker starts on the active model’s provider,
and changing providers clears search. Selection and the current-model marker both use the
provider and model ID, so identical IDs from different providers remain distinct.

The old dropdown is replaced by the existing Radix-backed dialog and command
components. These provide modal focus management, Escape dismissal, and keyboard
navigation. Pointer events inside the modal stop bubbling to the chat input's
container, preventing its textarea-focus handler from stealing modal focus.
The picker is disabled without an active session or while the agent connects,
and is remounted on session changes to discard an open picker for the old session.

Provider logos are local SVG assets with attribution and the upstream MIT license.
Unknown providers and failed images use an initials fallback.

## Regression coverage

`src/tests/renderer/ModelSelector.test.tsx` covers inclusion of built-in providers,
provider sidebar navigation, model ID search, duplicate IDs across providers,
keyboard selection, dismissal, focus restoration, search reset, empty/disabled
states, and image fallback. The existing `ChatInput.test.tsx` empty-state case now
uses an empty backend list rather than expecting valid providers to be hidden.

## Theme correction

The first version inherited a solid cyan command highlight and default border
colors, and rendered logos on white tiles. This clashed with the app’s charcoal
surfaces and muted warm-gray text. The picker now uses the existing `surface-*`
and `text-*` tokens for its backdrop, borders, navigation, and model highlight.
Logos have no white backing and render in muted monochrome on dark surfaces.
Shared component defaults and the rest of the app’s palette are unchanged.

Provider counts use the secondary text token at rest and the primary text token
on hover, keyboard focus, and selection, keeping them readable on highlighted
sidebar rows.
