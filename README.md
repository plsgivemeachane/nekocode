# NekoCode

AI-powered coding assistant desktop app built with Electron, React, and TypeScript.

## Features

- **Multi-session AI chat** — Create and manage multiple AI coding sessions per project
- **Multi-project workspace** — Add/remove projects with session trees and Git branch detection
- **Real-time streaming** — Token-by-token AI response streaming with batched delivery
- **Thinking content display** — Inline rendering of AI thinking/reasoning blocks during streaming
- **Tool call visualization** — Inspect AI tool calls and results inline with collapsible sections
- **Workflow step progress** — Visual progress tracking for multi-step AI agent workflows
- **Slash commands & command palette** — Discover and execute slash commands via an interactive command palette
- **Command history** — Navigate through previous prompts with arrow keys
- **Rich markdown rendering** — Shiki syntax highlighting, GFM tables, clickable file links
- **Model selection** — Switch between AI providers/models at runtime
- **Extension system** — Dynamic extension loading with lifecycle management and fallback diagnostics
- **Worker thread pool** — CPU-intensive operations offloaded to background threads with session affinity
- **Notification sounds** — Configurable sound effects and notification settings panel
- **Settings view** — In-app settings management with notification preferences
- **Frameless window** — Custom titlebar with flat navigation buttons for a native feel
- **Auto-updater** — Seamless updates via GitHub releases
- **Virtual scrolling** — Smooth performance with hundreds of messages via react-virtuoso
- **Refresh messages** — Reload session messages from disk via context menu
- **Patch verification** — Automated patch integrity checks before builds

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 42 |
| UI | React 19 + Tailwind CSS 4 + Radix UI |
| Build | electron-vite + Vite |
| Package Manager | Bun |
| Testing | Vitest + Testing Library |
| Linting | ESLint 9 + typescript-eslint |
| AI Engine | `@earendil-works/pi-coding-agent` |
| Virtual Scroll | react-virtuoso |
| Markdown | react-markdown + remark-gfm + Shiki |
| Logging | Winston + daily-rotate-file |
| Patching | patch-package |
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
| `bun run package:all` | Build + package for all platforms |
| `bun run test` | Run tests (Vitest) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage |
| `bun run lint` | Lint with ESLint |
| `bun run type-check` | TypeScript type checking |
| `bun run release` | Build + publish to GitHub Releases |
| `bun run verify:patches` | Verify patch integrity |
| `bun run build:worker` | Build the worker thread bundle |
| `bun run version:up` | Auto-increment patch version |
| `bun run version:up:dry` | Dry-run version increment |

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
│   ├── notification-service.ts # Notification sound management
│   ├── electron-ui-context.ts  # UI context for agent interactions
│   ├── manager-types.ts     # Shared manager interface types
│   ├── text-extractor.ts    # Text extraction for AI context
│   ├── updater.ts           # Auto-updater
│   ├── logger.ts            # Winston logging
│   └── threading/           # Worker thread pool
│       ├── index.ts                    # Thread pool entry point
│       ├── thread-operation-queue.ts   # Operation queue with priorities
│       ├── threaded-project-manager.ts # Threaded project operations
│       ├── threaded-session-manager.ts # Threaded session operations
│       ├── worker-bootstrap.ts         # Worker thread bootstrap & SDK
│       └── types.ts                    # Threading type definitions
├── preload/                 # Electron preload (IPC bridge)
├── renderer/                # React UI
│   └── src/
│       ├── App.tsx          # Root component
│       ├── components/
│       │   ├── chat/        # ChatView, MessagesTimeline, ChatInput, etc.
│       │   │   ├── AssistantMessage.tsx
│       │   │   ├── ChatInput.tsx
│       │   │   ├── ChatView.tsx
│       │   │   ├── CommandPalette.tsx
│       │   │   ├── GlobalCommandPalette.tsx
│       │   │   ├── MarkdownContent.tsx
│       │   │   ├── MessagesTimeline.tsx
│       │   │   ├── ThinkingBlock.tsx
│       │   │   ├── ToolCallSection.tsx
│       │   │   ├── UIDialog.tsx
│       │   │   ├── UserMessage.tsx
│       │   │   ├── WorkflowStepProgress.tsx
│       │   │   └── tool-summary.ts
│       │   ├── layout/      # NavBar, TreeSidebar, StatusIndicator
│       │   ├── session/     # SessionView
│       │   ├── settings/    # SettingsView (notification preferences)
│       │   └── ui/          # WelcomeScreen, ContextMenu, NotificationSettings
│       ├── hooks/           # Custom React hooks
│       │   ├── useSession.ts          # Session state & operations
│       │   ├── useSessionEvents.ts    # Session event subscription
│       │   ├── useSessionOrchestration.ts # Session lifecycle orchestration
│       │   ├── useAutoScroll.ts       # Auto-scroll on new messages
│       │   ├── useClickOutside.ts     # Click outside detection
│       │   ├── useCommandHistory.ts   # Command history navigation
│       │   ├── useCommands.ts         # Slash command execution
│       │   ├── useModelSelection.ts   # Model/provider switching
│       │   ├── useUIRequests.ts       # UI request handling (dialogs)
│       │   ├── useWorkflowSteps.ts    # Workflow step tracking
│       │   └── useZoom.ts             # Zoom level management
│       ├── stores/          # project-store.tsx
│       ├── types/           # chat.ts
│       └── utils/           # message-transforms, project-helpers, logger,
│                            sound-manager, extension-logging
├── shared/                  # Types shared between main and renderer
│   ├── ipc-types.ts         # IPC request/response/event types
│   └── ipc-channels.ts      # IPC channel name constants
└── tests/                   # Unit and integration tests
    ├── main/              # Main process tests
    ├── renderer/          # Renderer/hook tests
    └── shared/            # Shared type tests

scripts/                        # Build & utility scripts
├── auto-upversion.cjs      # Auto patch version increment
├── build-worker.cjs        # Worker thread bundler
├── build-worker-plugin.ts  # esbuild plugin for worker
└── verify-patches.cjs      # Patch integrity verification

docs/                           # Documentation
├── bugs/               # Bug reports & resolutions
├── features/           # Feature documentation
└── research/           # Research & decision logs
```

## Architecture

NekoCode is an Electron app with a clear separation between processes:

- **Main process** (`src/main/`) — Handles filesystem, Git, native OS operations, AI session management, worker thread orchestration, and notification sounds.
- **Preload** (`src/preload/`) — Exposes a typed IPC bridge to the renderer via `contextBridge`.
- **Renderer** (`src/renderer/`) — React 19 UI with Tailwind CSS styling, Radix UI primitives, and virtual scrolling via react-virtuoso.
- **Shared** (`src/shared/`) — TypeScript types for IPC communication, used by both main and renderer.

The AI engine runs in worker threads via `@earendil-works/pi-coding-agent`, with the SDK bundled into the worker for reliable production builds. Responses are streamed token-by-token through `StreamBatcher` and rendered in the chat UI with Shiki syntax highlighting. Thinking/reasoning blocks are displayed inline during streaming, and multi-step workflow progress is visualized with dedicated UI components.

### Threaded Architecture

CPU-intensive operations (session management, project operations) are offloaded to a worker thread pool with:
- **Session affinity** — Operations for a given session are routed to the same worker
- **Priority queue** — High/normal/low priority operation scheduling
- **Graceful fallback** — Automatic fallback to main-thread managers if workers fail

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for our code of conduct, and [SECURITY.md](SECURITY.md) for security reporting.

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

MIT License — see [LICENSE](LICENSE) for details.

Copyright © 2026 Nekocode™