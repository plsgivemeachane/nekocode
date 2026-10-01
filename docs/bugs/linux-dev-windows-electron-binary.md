# Linux development launches the Windows Electron binary

## Symptoms

Running `bun run dev` on Linux built the main and preload processes and started
the renderer server, then failed while launching Electron:

```text
node_modules/electron/dist/electron.exe: 1: Syntax error: word unexpected (expecting ")")
```

## Cause

This checkout had previously installed dependencies on Windows. Its shared
`node_modules/electron/path.txt` still pointed to `electron.exe`, and the
Electron distribution contained Windows binaries. Installing dependencies
with Bun did not replace that distribution. Electron's path resolver accepts
an existing executable without checking whether it matches the host platform.
Linux therefore tried to execute the Windows binary as a shell script.

## Fix

The `dev` script now runs Electron's own `install.js` with Bun before building the worker
and starting electron-vite. That installer checks the installed version,
platform-specific executable path, and executable existence. It exits quickly
when the correct distribution is already installed; otherwise it downloads
and extracts the distribution for the current platform and architecture and
updates `path.txt`. This also supports switching the shared checkout back to
Windows or macOS. No additional dependencies are required.

On this machine, running the installer with Node 26.7.0 returned success after
a cache hit without extracting the archive or updating `path.txt`. Running the
same installer with Bun completed extraction and selected `dist/electron`.
Using the project's required Bun runtime avoids that observed installer failure.

After repairing the binary, Chromium also aborted because the checkout's
mounted Windows drive did not provide the required root-owned, mode-4755
`chrome-sandbox` helper. Testing `--disable-setuid-sandbox` confirmed that the
host also blocked the user-namespace fallback (`No usable sandbox!`). The
`scripts/start-dev.cjs` launcher therefore passes `--no-sandbox` to Electron
on Linux development runs only. Windows and macOS development and all packaging
scripts remain unchanged. Linux development runs consequently do not have
Chromium's process sandbox; use this launcher for trusted local development.

The first development launch after switching platforms may need network access.
Packaging uses its own Electron distribution and does not repair the development
installation, so producing a Linux AppImage alone did not resolve this issue.

## Validation

Reproduce the failure with the Windows installation, then run `bun run dev`
after the change and verify that Electron selects `dist/electron` on Linux
and starts the app. The renderer server requires permission to bind localhost,
and opening the desktop window requires access to the graphical session.

The repaired command was verified on Linux x64: the dev server bound port 5173,
Electron logged `App ready` and `BrowserWindow created`, loaded the development
URL, initialized both workers, and completed model-list IPC requests. Lint and
type-check passed. The full test run had 1,710 passes and 53 failures across
three renderer test files accessing unavailable `localStorage` under Node 26.
The running renderer also reported a separate Shiki WebAssembly CSP rejection;
that is outside the platform-selection and startup fix.
