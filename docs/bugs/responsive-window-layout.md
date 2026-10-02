# Responsive layout breaks when resizing the window

## Report

At a short, narrow desktop window size (the supplied screenshot is approximately 936 × 293 pixels), the title bar crowded its search control and project actions. The fixed sidebar widths consumed available space, while the chat layout could retain its content height and push the composer below the visible window.

The requested behavior is a responsive desktop layout, an icon-only search control aligned to the right in compact mode, and thinner scrollbars.

## Causes

- The chat root and its main flex child lacked `min-h-0`, which allows nested flex children to shrink into the available window height.
- The title bar reserved a 240px branding region, displayed full action labels and zoom controls, and attempted to retain an expanded search bar in narrow windows.
- The left sidebar retained its user-selected width regardless of viewport size. An open right panel also consumed its selected width alongside the chat.
- The composer used desktop padding and allowed drafts to grow to 200px even in a very short window. Long model names and project/branch metadata could exceed their allocated width.
- Native scrollbars were 6px; Radix scrollbar tracks were 10px.

## Fix

- Keep the title bar at 48px and compact branding/actions below the 1024px Tailwind `lg` breakpoint. Search collapses into an accessible icon button aligned to the right of its flexible region, before the project/window actions. Its existing search-palette event and keyboard shortcuts are preserved. Full search returns and centers at wider widths.
- Add minimum-size constraints to the chat flex chain. Keep the composer and status/error regions visible while the timeline takes the remaining height.
- Reduce horizontal chat/composer padding at narrower widths and allow empty-state shortcuts and status details to wrap.
- Limit the left sidebar to 28% of viewport width without changing its saved width. Below 1024px, show the right content panel over the chat instead of consuming horizontal layout space; retain its icon rail and close control. At wider sizes, cap its width to leave room for chat content.
- Cap textarea height at the smaller of 200px or 20% of viewport height, retaining internal scrolling for long drafts. Allow the model trigger to shrink and truncate long names. Truncate project/branch metadata within its flex row.
- Reduce native scrollbar width/height to 4px and Radix scrollbar tracks to 6px, with narrower thumbs after padding.

## Validation

- Targeted existing chat, composer, sidebar, and status tests passed (146 tests).
- NavBar regression coverage checks compact search and branding classes, stable header height, accessible naming, and the existing search event behavior.
- Full Vitest suite passed: 85 files, 1,797 tests (25 existing TODOs). The final right-alignment assertion also passed with all 17 NavBar tests. ESLint and TypeScript checks passed. Local Electron packaging is verified separately in the task report.
- Browser geometry validation was attempted with the installed Chromium-based browser, but it exited before rendering (exit 133). A real Electron resize/visual check remains a validation gap. Unit tests do not prove pixel geometry.

## Scope

Existing model-selector and message-timeline edits in the workspace were preserved. No dependencies or window minimum-size restrictions were added. Existing code comments were retained.
