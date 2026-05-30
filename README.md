# NekoCode

> There are many agent harnesses, but this one is yours.

NekoCode is an Agent Development Environment built on [Pi Agent](https://github.com/earendil-works/pi). It gives Pi a desktop — multi-session management, project workspaces, extension lifecycle, visual session trees, and tool call inspection — everything Pi's terminal interface doesn't provide.

NekoCode runs Pi Agent in worker threads with session affinity and priority queuing. Responses stream token-by-token, thinking blocks render inline, and extensions load dynamically with fallback diagnostics. The renderer is React 19 + Tailwind + Radix UI inside an Electron shell.

NekoCode does not replace Pi. It hosts it. Your Pi extensions, skills, prompt templates, and themes work here too. If you use Pi at the terminal, NekoCode is what happens when you give it a home.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.3.4+
- [Node.js](https://nodejs.org/) 20+

### Install & Run

```bash
bun install
node node_modules/electron/install.js   # Bun may skip Electron postinstall
bun run dev
```

### Build & Package

```bash
bun run package:local    # Current platform
bun run package          # Windows
bun run package:mac      # macOS
bun run package:linux    # Linux
bun run package:all      # All platforms
```

---

## Sessions

| Feature | How |
|---------|-----|
| Create session | Per-project session creation with model selection |
| Branch | Visual session tree — jump to any point, continue from there |
| Compact | Automatic context compaction when approaching limits |
| Resume | Switch between sessions per project |
| Stream | Token-by-token AI responses with batched delivery |

Sessions are managed by Pi's `SessionManager` running in a worker thread. Session files use Pi's JSONL tree format.

---

## Projects

| Feature | How |
|---------|-----|
| Add project | Select any directory as a project workspace |
| File tree | Sidebar with project context |
| Git awareness | Branch detection baked into session management |
| Multi-project | Add/remove projects, each with its own session tree |

---

## Extensions

NekoCode loads Pi extensions dynamically with lifecycle management and fallback diagnostics.

```typescript
// Your Pi extension works here — no changes needed
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "deploy", ... });
  pi.registerCommand("stats", { ... });
  pi.on("tool_call", async (event, ctx) => { ... });
}
```

See [Pi's extension docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/extensions.md) and [examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions).

---

## What You See

| Area | What |
|------|------|
| Chat panel | Messages, tool calls, thinking blocks, workflow progress |
| Session tree | Visual branching and compaction history |
| Project sidebar | File tree with project context |
| Tool call sections | Collapsible inline inspection of agent actions |
| Settings view | In-app preferences — models, thinking level, notifications |
| Command palette | Slash commands and history navigation |

Markdown rendering uses Shiki syntax highlighting, GFM tables, and clickable file links.

---

## Development

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development mode |
| `bun run build` | Build for production |
| `bun run test` | Run tests (Vitest) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage |
| `bun run lint` | Lint with ESLint |
| `bun run type-check` | TypeScript type checking |
| `bun run verify:patches` | Verify patch integrity |

### Required Checks Before Commit

```bash
bun run test
bun run lint
bun run type-check
bun run package:local
```

---

## Architecture

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
│   ├── threading/           # Worker thread pool
│   └── ...
├── preload/                 # Electron preload (IPC bridge)
├── renderer/                # React UI
│   └── src/
│       ├── components/      # Chat, layout, session, settings, UI
│       ├── hooks/           # Custom React hooks
│       ├── stores/          # Project store
│       ├── types/           # Chat types
│       └── utils/           # Message transforms, helpers, logging
├── shared/                  # Types shared between main and renderer
└── tests/                   # Unit and integration tests
```

### Threaded Engine

CPU-intensive operations run in a worker thread pool:
- **Session affinity** — Operations for a session route to the same worker
- **Priority queue** — High/normal/low priority scheduling
- **Graceful fallback** — Automatic fallback to main-thread managers if workers fail

### Built On

| | |
|---|---|
| **Agent Engine** | [Pi Agent](https://github.com/earendil-works/pi) — extensible, minimal agent harness |
| **Runtime** | Electron 42 |
| **UI** | React 19 + Tailwind CSS 4 + Radix UI |
| **Build** | electron-vite + Vite |
| **Package Manager** | Bun |

---

## Known Issues

- **Electron binary missing after `bun install`** — Bun may skip Electron's postinstall script. Run `node node_modules/electron/install.js` manually. See [docs/bugs/electron-binary-missing-postinstall-skip.md](docs/bugs/electron-binary-missing-postinstall-skip.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for our code of conduct, and [SECURITY.md](SECURITY.md) for security reporting.

## License

MIT License — see [LICENSE](LICENSE) for details.

Copyright © 2026 Nekocode™
