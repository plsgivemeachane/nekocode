# Packaging commands selected Windows on Linux

## Bug

`package` and `package:local` unconditionally passed `--win` to Electron Builder.
Running the local packaging command on a Linux development host therefore built a
Windows application and failed when Electron Builder needed Wine to update the
Windows executable. TypeScript, renderer, preload, and worker compilation could
all succeed before that failure, obscuring the actual platform mismatch.

## Fix

The generic commands now let Electron Builder select the host operating system.
Explicit commands select the target independently of the host:

| Target | Version-bumping command | Local command (no version bump) |
| --- | --- | --- |
| Host OS | `bun run package` | `bun run package:local` |
| Windows | `bun run package-window` | `bun run package-window:local` |
| macOS | `bun run package-mac` | `bun run package-mac:local` |
| Linux | `bun run package-linux` | `bun run package-linux:local` |

The existing `package:mac` and `package:linux` names remain compatibility aliases
for their local target commands, preserving their previous no-version-bump
behavior. `package:all` retains its multi-platform
behavior. Build preparation still applies and verifies SDK patches, builds the
Electron application, and bundles the worker before packaging. Explicit Windows
cross-packaging on Linux still requires Wine; choosing a Windows target does not
install cross-compilation tooling.

Linux packaging also exposed an icon conversion failure: the repository only
provided `resources/icon.ico`, and Electron Builder's Linux icon-set converter
reported `unknown output format set` for that input. Added a lossless PNG-format
copy of the same 256×256 icon as `resources/icon.png` and explicitly configured
the Linux target to use it. Windows continues to use the original ICO file.

## Validation

The original Windows-targeting command was reproduced on Linux: compilation and
worker validation passed, then Electron Builder reported that Wine was required.
The replacement Linux command and the repository test/lint/type checks are run
as part of the branch migration; their final results are recorded in
`opencodeui-general-changes-main-port.md`.
