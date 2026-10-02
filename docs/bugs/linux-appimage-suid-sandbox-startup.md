# Direct Linux AppImage launch aborts before application startup

## Symptoms

Launching `./dist/Nekocode-0.2.70.AppImage` aborts with a trace trap:

```text
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166
The SUID sandbox helper binary was found, but is not configured correctly.
```

Chromium reports that the temporary AppImage mount's `chrome-sandbox` must be
owned by root with permissions `4755`. The crash occurs before JavaScript main
process initialization, so changing BrowserWindow preferences cannot fix it.

## Root cause and evidence

Extracting `AppRun` from the reported 0.2.70 artifact shows that both its
zero-argument and argument-bearing paths execute the bundled Electron binary
directly without sandbox arguments. electron-builder 26.8.1 adds a default
`--no-sandbox` to the AppImage desktop entry, but direct terminal execution
does not use that desktop entry. AppImage's mounted bundle cannot be repaired
persistently with chmod/chown.

On this host, the development helper has owner `65534` and mode `777` on `/mnt/e`.
Both `kernel.unprivileged_userns_clone` and
`kernel.apparmor_restrict_unprivileged_userns` report `1`. The latter can block
the alternative namespace sandbox. The earlier development bug report records
that `--disable-setuid-sandbox` alone failed here with `No usable sandbox`.

The same error was also reported for `bun run dev`. The current checkout already
uses `scripts/dev.cjs`, which checks the installed helper and forwards the
supported electron-vite `--noSandbox` option on this host. It maps to Electron's
`--no-sandbox`. That existing development fallback is covered separately in
`linux-dev-suid-sandbox-startup.md`; the new packaging fix does not replace it.

## Fix

`package.json` registers `scripts/after-pack.cjs` as an electron-builder
`afterPack` hook. For Linux builds containing the AppImage target, it preserves
the native executable as `nekocode.bin` and installs
`scripts/linux-appimage-launcher.sh` under the original executable name. This
places the compatibility check before Electron's native sandbox initialization
without modifying Electron or electron-builder dependencies.

When running inside AppImage and the bundled helper is present but not
root-owned with exact mode `4755`, the wrapper probes user and network namespace
creation with util-linux `unshare -Urn -- true`. When the probe succeeds, it uses
`--disable-setuid-sandbox`, allowing Chromium's namespace sandbox. When the
probe is unavailable or fails, it prints a warning and uses `--no-sandbox`.

A correctly configured helper, a missing helper, and launches outside AppImage
retain default sandbox behavior. Explicit `--no-sandbox` or
`--disable-setuid-sandbox` arguments are respected. All other arguments retain
their boundaries and contents, including spaces and shell metacharacters.
Windows, macOS, and Linux builds without an AppImage target are not wrapped.

## Security and limitations

`--no-sandbox` disables Chromium's process sandboxes even though the application
still configures `sandbox: true` and `contextIsolation: true`. This is a
compatibility fallback for the affected environment, not equivalent protection.
For fully sandboxed use on a host that blocks unprivileged namespaces, an
administrator must supply a usable installed SUID helper or an appropriate
AppArmor profile for an installed fixed-path executable. No system permissions,
sysctls, or AppArmor rules are changed by this fix.

The namespace probe is a practical availability check, not proof that every
Chromium sandbox operation will succeed under every security policy. Future
configuration of Electron fuses must account for the renamed native executable
because this hook runs before electron-builder's built-in fuse processing.

Existing AppImages are not rewritten by source changes. Rebuild with
`bun run package:local` (or `bun run package-linux:local`). For the already-built
artifact, the immediate local workaround is:

```sh
./dist/Nekocode-0.2.70.AppImage --no-sandbox
```

## Verification

`src/tests/linux-appimage-launcher.test.ts` exercises the actual packaging hook
and generated executable with a harmless native-binary stand-in. It verifies
fallback selection, namespace availability, valid/missing helpers, explicit
overrides, argument preservation, and platform/target boundaries. Development
argument regression coverage remains in `src/tests/dev-launcher.test.ts`.

Validation completed on 2026-10-02:

- `bun run test`: 103 files passed, 1,893 tests passed, 25 existing TODOs.
- `bun run lint` and `bun run type-check`: passed.
- `sh -n scripts/linux-appimage-launcher.sh`, `node --check
  scripts/after-pack.cjs`, and `git diff --check`: passed.
- `bun run dev` with `ELECTRON_EXEC_PATH` pointing to a harmless argument-printing
  stub: built the worker, main process, and preload, started Vite, printed the
  development fallback warning, and passed `.` and `--no-sandbox` to the stub.
  This verifies the real dev launch path without opening a desktop window.
- `bun run package:local`: passed and produced
  `dist/Nekocode-0.2.67.AppImage`, matching the unchanged checkout version.
- Extracting `nekocode` from the rebuilt AppImage and comparing it to
  `scripts/linux-appimage-launcher.sh`: byte-for-byte match. The preserved
  `nekocode.bin` in the staged bundle remains an x86-64 ELF executable.
- Direct rebuilt-AppImage headless smoke run using `--ozone-platform=headless
  --disable-gpu`, isolated `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`, and a 12-second
  timeout: emitted the compatibility warning, reached `App ready, loading
  workspace`, created BrowserWindow, loaded the production renderer, and started
  worker operations. It remained running until the intentional timeout (exit
  124), without the SUID fatal error. Desktop appearance was not inspected.

Production compilation still emits the existing upstream Pi extension-loader
`import.meta`/CJS warning. It did not prevent packaging or the startup smoke test.

## Primary references

- [Electron process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Chromium Linux sandbox](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/linux/README.md)
- [Chromium AppArmor namespace restrictions](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)
- [electron-builder hooks](https://www.electron.build/v26/docs/features/hooks/)
