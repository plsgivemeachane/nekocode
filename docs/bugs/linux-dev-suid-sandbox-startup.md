# Linux development startup aborts on a misconfigured SUID sandbox

## Symptoms

`bun run dev` builds the app and starts Vite at `http://localhost:5173/`, then
Electron aborts before opening a window:

```text
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166
The SUID sandbox helper binary was found, but is not configured correctly.
```

The message requires `node_modules/electron/dist/chrome-sandbox` to be owned by
root with mode `4755`.

## Cause

The development script launched Electron through electron-vite with its default
sandbox settings. On the affected Linux environment, the repository lives on a
mounted Windows drive (`/mnt/e`), and the helper reports owner `nobody` and mode
`777`. Chromium rejects that helper before application code runs, so changing
`BrowserWindow.webPreferences` cannot fix this startup failure.

Testing `--disable-setuid-sandbox` also failed with `No usable sandbox`: this
environment blocks the alternative unprivileged user-namespace sandbox. Merely
skipping the SUID helper therefore does not resolve this environment's failure.

## Fix

`package.json` now starts local development through `scripts/dev.cjs` after the
existing worker build. The launcher checks the installed helper on Linux. When
its owner is not root or its permission bits are not `4755`, it forwards
electron-vite's supported `--noSandbox` option and prints a warning explaining
that Chromium sandboxing is disabled for this development run.

The launcher forwards all user CLI arguments. Windows, macOS, and Linux with a
correctly configured helper retain their existing startup behavior. If no helper
exists, the launcher leaves Chromium free to use its native namespace fallback.
Unexpected filesystem errors are reported rather than hidden.

This is a development-only workaround. Chromium's process sandbox is disabled
for affected local development runs; use trusted local content. Build, preview,
packaging scripts, and the application's `sandbox: true` preference are unchanged.
No system permissions or kernel sandbox policy are modified. Restoring a usable
root-owned `4755` helper automatically restores the default development launch.

## Verification

`src/tests/dev-launcher.test.ts` covers invalid ownership, missing setuid bits,
unsafe permissions, valid Linux helpers, missing helpers, Windows/macOS behavior,
and CLI argument forwarding. Run with `bun run test src/tests/dev-launcher.test.ts`.

For a runtime check, run `bun run dev` on the affected Linux host. The launcher
should print its development sandbox warning, start Vite, and open Electron
without the SUID sandbox fatal error.

Validation on the affected host:

- `bun run dev`: emitted the fallback warning and reached `App ready, loading
  workspace` without the SUID fatal error; stopped after a 30-second smoke run.
- `bun run test`: 73 test files passed, 1,644 tests passed, 5 existing TODOs.
- `bun run lint` and `bun run type-check`: passed.
- `node --check scripts/dev.cjs` and `git diff --check`: passed.
- `bun run package:local`: production compilation and worker build passed;
  Windows packaging failed because Wine is not installed on this Linux host.
  The Windows artifact could not be fully validated here.
