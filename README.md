# NekoCode

AI-powered coding assistant desktop app built with Electron, React, and TypeScript.

## Features

- **Multi-session AI chat** — Create and manage multiple AI coding sessions per project
- **Multi-project workspace** — Add/remove projects with session trees and Git branch detection
- **Real-time streaming** — Token-by-token AI response streaming with batched delivery
- **Tool call visualization** — Inspect AI tool calls and results inline
- **Rich markdown rendering** — Shiki syntax highlighting, GFM tables, clickable file links
- **Model selection** — Switch between AI providers/models at runtime
- **Extension system** — Dynamic extension loading with lifecycle management
- **Worker thread pool** — CPU-intensive operations offloaded to background threads
- **Auto-updater** — Seamless updates via GitHub releases
- **Virtual scrolling** — Smooth performance with hundreds of messages

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 34 |
| UI | React 19 + Tailwind CSS 4 + Radix UI |
| Build | electron-vite + Vite |
| Package Manager | Bun |
| Testing | Vitest + Testing Library |
| Linting | ESLint 9 + typescript-eslint |
| AI Engine | `@earendil-works/pi-coding-agent` |
| Markdown | react-markdown + remark-gfm + Shiki |
| Logging | Winston + daily-rotate-file |
| Packaging | electron-builder (NSIS, portable, DMG, AppImage) |

## Prerequisites

- [Bun](https://bun.sh/) v1.3.4+
- [Node.js](https://nodejs.org/) 20+

## Getting Started

```bash
# Install dependencies
bun install

# Verify Electron binary exists (Bun may skip postinstall)
node node_modules/electron/install.js

# Start dev server + Electron app
bun run dev
```

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start development mode (Vite dev server + Electron) |
| `bun run build` | Build for production |
| `bun run package:local` | Build + package for current platform |
| `bun run package` | Bump version + build + package for Windows |
| `bun run package:mac` | Build + package for macOS |
| `bun run package:linux` | Build + package for Linux |
| `bun run test` | Run tests (Vitest) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage |
| `bun run lint` | Lint with ESLint |
| `bun run type-check` | TypeScript type checking |
| `bun run release` | Build + publish to GitHub Releases |

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, window creation, lifecycle
│   ├── ipc-handlers.ts      # IPC handler registration
│   ├── session-manager.ts   # AI session orchestration, streaming
│   ├── project-manager.ts   # Project/workspace management
│   ├── extension-loader.ts  # Extension discovery and loading
│   ├── stream-batcher.ts    # AI response stream batching
│   ├── message-store.ts     # Message persistence
│   ├── text-extractor.ts    # Text extraction for AI context
│   ├── updater.ts           # Auto-updater
│   ├── logger.ts            # Winston logging
│   └── threading/           # Worker thread pool
├── preload/                 # Electron preload (IPC bridge)
├── renderer/                # React UI
│   └── src/
│       ├── App.tsx          # Root component
│       ├── components/
│       │   ├── chat/        # ChatView, MessagesTimeline, ChatInput, etc.
│       │   ├── layout/      # NavBar, TreeSidebar, StatusIndicator
│       │   ├── session/     # SessionView
│       │   └── ui/          # WelcomeScreen, ContextMenu
│       ├── hooks/           # useSession, useAutoScroll, useZoom, etc.
│       ├── stores/          # project-store.tsx
│       ├── types/           # chat.ts
│       └── utils/           # message-transforms, project-helpers, logger
├── shared/                  # Types shared between main and renderer
│   ├── ipc-types.ts         # IPC request/response/event types
│   └── ipc-channels.ts      # IPC channel name constants
└── tests/                   # Unit and integration tests
```

## Architecture

NekoCode is an Electron app with a clear separation between processes:

- **Main process** (`src/main/`) — Handles filesystem, Git, native OS operations, AI session management, and worker thread orchestration.
- **Preload** (`src/preload/`) — Exposes a typed IPC bridge to the renderer via `contextBridge`.
- **Renderer** (`src/renderer/`) — React 19 UI with Tailwind CSS styling, Radix UI primitives, and Monaco-based code editing.
- **Shared** (`src/shared/`) — TypeScript types for IPC communication, used by both main and renderer.

The AI engine runs in the main process via `@earendil-works/pi-coding-agent`, with responses streamed token-by-token through `StreamBatcher` and rendered in the chat UI with Shiki syntax highlighting.

## Required Checks Before Commit

```bash
bun run test
bun run lint
bun run type-check
bun run package:local
```

## Known Issues

- **Electron binary missing after `bun install`** — Bun may skip Electron's postinstall script. Run `node node_modules/electron/install.js` manually. See [docs/bugs/electron-binary-missing-postinstall-skip.md](docs/bugs/electron-binary-missing-postinstall-skip.md).

## License

Copyright © 2026 Nekocode™
