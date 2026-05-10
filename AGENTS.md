# PROJECT IDENTITY — READ THIS FIRST, EVERY SESSION, NO EXCEPTIONS

**PROJECT NAME:** NekoCode  
**REPO ROOT:** E:/project/node/nekocode  
**WHAT IT IS:** AI-powered coding assistant desktop app  
**VERSION:** 0.2.x (active development)  
**TECH STACK:** Electron + React + TypeScript + Tailwind + Radix UI + Biome  
**BUILD TOOL:** electron-vite  
**PACKAGE MGR:** Bun (NEVER npm)  
**TEST RUNNER:** Vitest (via `bun run test`)  
**LINTER:** ESLint

---

## Universal Context Rule — Absolutely Binding

Every question, bug report, error paste, feature request, or code snippet the user provides in this project folder is about **NekoCode**. There are no exceptions. You must NOT ask "which project?" or "is this about NekoCode?" — it always is. Specifically:

| User says | It means |
|---|---|
| A pasted stack trace or error | Comes from NekoCode's runtime or build |
| "the editor" | NekoCode's Monaco-based editor component |
| "the terminal" | NekoCode's integrated terminal |
| "the sidebar" | NekoCode's TreeSidebar component |
| "the chat" | NekoCode's ChatView / AI conversation panel |
| "sessions" | NekoCode's session management (SessionManager) |
| "extensions" | NekoCode's extension system (extension-loader) |
| "IPC" | NekoCode's Electron main↔renderer IPC bridge |
| "streaming" | NekoCode's AI response streaming (StreamBatcher) |
| "a component" | A React component in `src/renderer/src/components/` |
| "a hook" | A custom React hook in `src/renderer/src/hooks/` |
| "the store" | NekoCode's project store (project-store.tsx) |
| "a test" | A test in `src/tests/` |
| "the build" | electron-vite build for NekoCode |
| A vague "it's broken" | Something in NekoCode is broken |
| A feature request | A feature for NekoCode |
| "how does auth work?" | NekoCode's provider auth |

If the user says "fix the bug where X doesn't work", X is a NekoCode feature.  
If the user pastes a TypeScript error, it's from NekoCode's type-check.  
**Do NOT ask for clarification about which project — the answer is always NekoCode.**

---

## Project Architecture Overview

NekoCode is an Electron desktop app structured as:

- **src/main/** → Electron main process
  - `index.ts` — Window creation, app lifecycle, auto-updater
  - `ipc-handlers.ts` — IPC handler registration (main↔renderer bridge)
  - `session-manager.ts` — AI session orchestration, streaming, compaction
  - `project-manager.ts` — Project/workspace management, file operations
  - `extension-loader.ts` — Extension discovery, loading, lifecycle
  - `stream-batcher.ts` — AI response stream batching and delivery
  - `message-store.ts` — Message persistence and retrieval
  - `text-extractor.ts` — Text extraction from files for AI context
  - `threading/` — Worker thread pool for heavy operations

- **src/preload/** → Electron preload (IPC bridge exposure)

- **src/renderer/** → React UI (runs in Electron BrowserWindow)
  - `App.tsx` — Root app component
  - `components/chat/` — ChatView, ChatInput, AssistantMessage, UserMessage, MessagesTimeline, ToolCallSection, MarkdownContent
  - `components/layout/` — NavBar, StatusIndicator, TreeSidebar
  - `components/session/` — SessionView
  - `components/ui/` — ContextMenu, WelcomeScreen
  - `hooks/` — useSession, useAutoScroll, useClickOutside, useModelSelection, useSessionEvents, useSessionOrchestration, useZoom
  - `stores/` — project-store.tsx
  - `types/` — chat.ts
  - `utils/` — message-transforms, project-helpers, logger, extension-logging

- **src/shared/** → Types shared between main and renderer
  - `ipc-types.ts` — All IPC request/response/event type definitions
  - `ipc-channels.ts` — IPC channel name constants

- **workers/** → Pi package & extension examples
  - `pi-package/examples/extensions/` — 50+ example extensions
  - `pi-package/examples/sdk/` — SDK usage examples

- **src/tests/** → Unit + integration tests for main, renderer, and shared modules

---

## Key Technology Connections

- **Electron** → Shell hosting the React renderer. Main process handles filesystem, Git, native OS.
- **React + Tailwind + Radix UI** → The entire UI. All components use Radix primitives with Tailwind styling. No raw CSS files.
- **Monaco** → Code editing surface inside the renderer.
- **Pi SDK** (`@mariozechner/pi-coding-agent`) → The AI agent framework NekoCode is built on.
- **electron-vite** → Build toolchain for the Electron app.
- **Bun** → Package manager and script runner.
- **Vitest** → Unit and integration testing.

---

## Package Manager Rules

- This project uses **Bun**, not npm.
- Always run scripts with `bun run <command>`.
- Never use `npm run <command>`.
- Use `bunx` instead of `npx`.
- Never use `npx` in this repository.

---

## Testing and Validation Rules

- Always run tests with `bun run test`.
- Never run `bun test` directly. It invokes Bun's internal test runner, not the project test runner.
- The `test` script in `package.json` maps to `vitest run`.

---

## Required Checks Before Commit

For every change, run **all** commands below and fix all errors before committing, even if they seem unrelated:

- `bun run test`
- `bun run lint`
- `bun run type-check`
- `bun run package:local`

---

## Code Comment Rule — Absolutely Binding

NEVER, EVER, EVER REMOVE ANY COMMENTS FROM THE CODE!!!  
If you need to alter the comments, PLEASE ADD MORE COMMENTS INSTEAD OF REMOVING THE OLD ONES.

---

## Bug Fix Documentation Rule — Absolutely Binding

For EVERY bug fix, you MUST write a full detailed description of the bug and how you fixed it into the `/docs/bugs/` folder.

---

## Common Shorthand

| User says | It means |
|---|---|
| "the app" | NekoCode desktop app (Electron) |
| "main process" | `src/main/` |
| "renderer" | `src/renderer/` |
| "preload" | `src/preload/` |
| "shared types" | `src/shared/` |
| "a provider" | An AI provider extension (Anthropic, GitLab Duo, Qwen) |
| "streaming" | AI token streaming via StreamBatcher |
| "IPC" | Electron IPC via ipc-handlers + ipc-channels |
| "threading" | Worker thread pool in `src/main/threading/` |
| "extensions" | NekoCode extension system (extension-loader) |
| "the worker" | Pi's background worker process |
| "pi-package" | The distributable package in `workers/pi-package/` |
