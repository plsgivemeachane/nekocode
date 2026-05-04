## Bug: Auto-updater logs ERR_XML_MISSED_ELEMENT as error when no GitHub releases are published

### Description

When the Nekocode Electron app starts, the auto-updater (electron-updater with GitHubProvider) checks GitHub for updates. If the repository has no published releases, electron-updater throws an ERR_XML_MISSED_ELEMENT error with the message "No published versions on GitHub". This error was logged at error level in two places:

1. The autoUpdater.on('error') event handler in src/main/updater.ts (line ~68)
2. The .catch() handler in initAutoUpdater() (line ~122)

This is misleading because having no published releases is a completely normal state for development builds, private repositories, or newly created repos. The error log creates noise and can confuse developers investigating actual issues.

### Symptoms

- Two error-level log entries appear on every app startup with code ERR_XML_MISSED_ELEMENT
- Stack trace points to GitHubProvider.getLatestVersion -> XElement.element in electron-updater internals

### Root Cause

The autoUpdater.on('error') event handler and the checkForUpdatesAndNotify().catch() handler did not distinguish between expected "no releases" scenarios and actual update-check failures (network errors, malformed responses, etc.). All errors were treated identically.

### Fix

Added a check in both error handlers for the specific combination of error code ERR_XML_MISSED_ELEMENT and message containing "No published versions on GitHub". When matched:

- The error is logged at info level instead of error level with a clear message: "No published versions on GitHub, skipping update check"
- The error event is NOT forwarded to the renderer via IPC_CHANNELS.UPDATE_ERROR (since it is not a real error the user needs to see)
- The initAutoUpdater catch block returns early without logging an error

### Files Changed

- src/main/updater.ts: Modified autoUpdater.on('error') handler and initAutoUpdater catch block

### Verification

- All 8 existing updater tests pass (bun run test -- src/tests/updater.test.ts)
- ESLint passes (bun run lint)
- TypeScript type-check passes (bun run type-check)