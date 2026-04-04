# Plan: Add Winston Logging to NekoCode

## Context

NekoCode is an Electron + React + TypeScript desktop app (AI coding assistant). Currently, all logging is done via raw console.log/error/warn calls scattered across 4 main files and 5 renderer files (~40 total calls). There is no structured logging, no log persistence, no log levels, and no way for users to debug issues from log files.

The goal is to replace all console.* calls with Winston (v3.19.0) to provide:
- Structured, leveled logging (error/warn/info/debug)
- File-based log persistence with daily rotation (winston-daily-rotate-file v5.0.0)
- Consistent log format with timestamps and module labels
- Development-friendly console output with colors
- Easy ability to adjust log verbosity

## Approach

### Architecture: One Logger Factory, Per-Module Child Loggers

Create a single logger.ts module in src/main/ that:
1. Creates the root Winston logger with configured transports
2. Exports a createLogger(moduleLabel) function that returns logger.child({ label: moduleLabel })
3. Uses app.getPath('userData') for log file location (same pattern as project-manager.ts line 34)

For the renderer process, Winston file transports will not work (no Node.js fs access). The renderer needs a lightweight approach:
- Create a simple logger.ts in src/renderer/src/ that wraps console.* with the same logger.info/error/warn/debug API and label prefix
- This keeps the renderer import API identical to main process, making future migration (e.g., sending logs to main via IPC) trivial

### Transport Configuration (Main Process)

| Transport | Level | Format | Purpose |
|-----------|-------|--------|---------|
| Console | debug (dev) / warn (prod) | Colorized simple + timestamp | Developer debugging |
| File (combined) | info | JSON with timestamp | Full persistent log |
| File (error) | error | JSON with timestamp | Error-only log for quick triage |
| Daily Rotate (combined) | info | JSON with timestamp | Rotating logs to prevent disk bloat |

### Console.* Mapping Rules

| Current Call | Winston Equivalent |
|---|---|
| console.log("[module] ...") | logger.info("...")  |
| console.error("[module] ...") | logger.error("...") |
| console.warn("[module] ...") | logger.warn("...") |
| console.log("[module] debug: ...") | logger.debug("...") |

The [module] prefix in existing messages is redundant since Winston label handles this and will be stripped during replacement.

### Verbose/Debug Logs Decision

Several existing console.log calls are clearly debug-level (e.g., handleAgentEvent, tool_execution_start/end with truncated JSON, ChatView message group counts, useSession tool_call matching). These will be mapped to logger.debug() so they do not noise up production logs but are available when needed.

## Files to Modify

### New Files
| File | Purpose |
|------|---------|
| src/main/logger.ts | Winston logger factory for main process |
| src/renderer/src/logger.ts | Lightweight console-wrapper logger for renderer |

### Modified Files (console.* replacement)
| File | Calls to Replace | Notes |
|------|-----------------|-------|
| src/main/index.ts | 4 calls | Window lifecycle, shutdown |
| src/main/project-manager.ts | 9 calls | Project CRUD, workspace persistence |
| src/main/session-manager.ts | 11 calls | Session lifecycle, agent events, tool execution |
| src/renderer/src/main.tsx | 1 call | App mount |
| src/renderer/src/hooks/useSession.ts | 6 calls | Session events, tool matching |
| src/renderer/src/components/TreeSidebar.tsx | 1 call | Unimplemented feature warning |
| src/renderer/src/components/ChatView.tsx | 1 call | Debug message count |
| src/renderer/src/stores/project-store.tsx | 8 calls | Error handling in store actions |

### Package Dependencies (install phase)
- winston ^3.19.0
- winston-daily-rotate-file ^5.0.0

## Reuse

- app.getPath('userData') - already used in src/main/project-manager.ts:34 for workspace path; same pattern for log directory
- import { app } from electron - available in all main process files
- Path alias @/* - defined in tsconfig.json; can use @/main/logger if needed
- Existing [module] label convention - the codebase already prefixes messages with [project], [session], [SessionManager], etc. These map directly to Winston label values

## Steps

- [ ] Step 1: Install dependencies - bun add winston winston-daily-rotate-file
- [ ] Step 2: Create src/main/logger.ts - Winston factory with console + file + daily-rotate transports, createLogger(label) export, app.getPath(userData) for log dir
- [ ] Step 3: Create src/renderer/src/logger.ts - Lightweight console wrapper with same createLogger(label) API, no Winston dependency
- [ ] Step 4: Replace console.* in src/main/index.ts - Import logger, replace 4 calls, strip [main] prefix
- [ ] Step 5: Replace console.* in src/main/project-manager.ts - Import logger with label "project", replace 9 calls, strip [project] prefix
- [ ] Step 6: Replace console.* in src/main/session-manager.ts - Import logger with label "session-manager", replace 11 calls, map verbose/event tracing to debug level
- [ ] Step 7: Replace console.* in src/renderer/src/main.tsx - Import renderer logger, replace 1 call
- [ ] Step 8: Replace console.* in src/renderer/src/hooks/useSession.ts - Import renderer logger with label "useSession", replace 6 calls, map tool matching traces to debug
- [ ] Step 9: Replace console.* in src/renderer/src/components/TreeSidebar.tsx - Replace 1 console.warn
- [ ] Step 10: Replace console.* in src/renderer/src/components/ChatView.tsx - Import renderer logger, replace 1 debug call with logger.debug
- [ ] Step 11: Replace console.* in src/renderer/src/stores/project-store.tsx - Import renderer logger with label "project-store", replace 8 console.error calls
- [ ] Step 12: Verify - Run bun run build, check for type errors; manually launch app and verify logs appear in console and log files

## Verification

1. Build check: bun run build - no TypeScript errors, logger modules resolve correctly
2. Console output: Launch app in dev mode - verify colored, timestamped, labeled log lines appear in terminal
3. File output: Check {userData}/logs/ directory - verify combined.log, error.log, and daily rotated files are created
4. Log rotation: Confirm winston-daily-rotate-file creates date-stamped files and cleans old ones
5. Renderer logs: Open DevTools console - verify renderer logs show [renderer:label] prefix format
6. Zero console.* remaining: grep for console. in src/ - should return 0 matches (excluding test files and node_modules)
