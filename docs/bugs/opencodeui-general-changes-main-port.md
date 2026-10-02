# Preserve general fixes and features from the OpenCode UI experiment

## Problem

`opencodeui` accumulated fixes and features useful to the regular application,
alongside an experimental terminal-style theme. Discarding that branch would lose
those improvements; merging its entire final tree would also import experimental
visual and interaction changes.

## Changes transferred to main

- Project addition: the threaded manager dispatched `project:add`, but the worker
  had no matching handler. Added worker dispatch/session discovery and synchronized
  the result into `ProjectManager` so workspace persistence and later operations
  see the added project. Source: `f9d1b9b`.
- Session diffs: eager rendering of every diff caused expensive large-session
  views. Ported Virtuoso rendering and selected-entry scrolling. Source: `c89ab38`.
- Streaming and event handling: shared the main/worker event processor and carried
  its callback boundaries, delta handling, and current SDK retry settlement.
  Existing SDK 0.99.2 support on main was retained. Sources: `5774a90`, `f1f422d`.
- IPC: ported the typed router with sender validation and the correct request,
  response, and broadcast contracts. Source: `5774a90`.
- Git polling: ported the shared visibility/backoff scheduler, concurrent refresh
  guard, cleanup guards, and empty-path/commit-message validation. Source: `5774a90`.
- Search: ported command/file/session search, IPC/preload contracts, supporting
  hooks, search-tab behavior fixes, and the empty-query timer cleanup on unmount.
  Sources: `55b7b97`, `5774a90`, `e8730c4`.
- Navigation: preserved finished-but-unread indicators, project collapsing on
  session changes, Add Folder access, sidebar drag/width corrections, scrolling
  fixes, and resizable Git panels.
- Component prerequisites: carried the pre-theme shadcn/Radix source components,
  semantic theme tokens, command keyboard handling, test observer mocks, and
  the branch's existing locked dependencies. This is necessary to retain the
  search and navigation functionality without bringing the terminal theme.
- Packaging: split explicit OS commands and made generic packaging select the
  host OS. See `os-specific-packaging.md`.

Relevant original bug explanations and regression tests accompany the source.
Existing comments are retained, including historical notes where implementation
was moved to a shared module.

## Deliberate exclusions

The OpenCode terminal theme, block cursor, and removal of the visible stop button
remain on `opencodeui`. The 15-second notification workaround is also excluded:
it uses a single global timer, so one session can cancel another session's pending
notification. Main already has SDK retry settlement handling. Runtime `.omx`
artifacts, experimental version bumps, and the unconditional Linux sandbox
workaround were not transferred.

## Verification

Final integration checks on the Linux x64 development host:

| Check | Result |
| --- | --- |
| `bun run test` | 84 files passed; 1,790 tests passed; 25 existing TODO tests |
| `bun run lint` | Passed |
| `bun run type-check` | Passed |
| `bun run package-linux:local` | Passed; Linux AppImage produced |
| `bun run package:local` | Passed; selected Linux and produced the AppImage |
| OS script/alias configuration assertions | Passed |
| Diff whitespace check with CRLF recognition | Passed |

The AppImage is written to `dist/Nekocode-0.2.67.AppImage`. Local packaging
preserved the existing main version. Windows and macOS target selection was
checked in the scripts; those platform builds were not executed on this host.
This validation does not constitute an interactive desktop UI smoke test.
