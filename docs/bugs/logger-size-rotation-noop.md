# Logger Size-Based Rotation No-Op in SimpleConsoleLogger

## Bug Description

In `src/main/logger.ts`, `SimpleConsoleLogger` (the logger used by worker threads and fallback environments where Winston is not available or Electron APIs are absent) had a stubbed size check in `maybeRotateLogFile()`:

```typescript
private maybeRotateLogFile(): void {
  if (!this.logFilePath) return
  try {
    const stats = statSync(this.logFilePath)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (stats.size > maxSize) {
      // TODO: Implement proper log rotation
      // For now, we just let the file grow until the next day
      // Daily rotation by filename already provides basic rotation
    }
  } catch {
    // File doesn't exist or can't stat, that's fine
  }
}
```

When a worker's daily log file (`worker-YYYY-MM-DD.log`) grew past the 5 MB threshold, execution fell into the empty `TODO` block. As a result, size-based rotation was a complete no-op, allowing a single day's log file to grow without bound until daily filename rotation triggered the following day.

## Root Cause

1. **Unimplemented Rotation**: `maybeRotateLogFile()` was only a placeholder stub that detected the file size exceeding 5 MB but performed no file rotation or backup creation.
2. **Missing Cascade Mechanism**: No file shifting logic existed to rename the active log to `.1.log`, `.1.log` to `.2.log`, etc., or prune backups beyond a retention cap.
3. **No In-Memory Size Tracking**: The initial code checked file size using `statSync`, which would be prohibitively slow to invoke on every log write. There was no in-memory size accumulator.
4. **Cleanup Incompatibility**: `SimpleConsoleLogger` had no retention cleanup for worker logs, and any external cleanup expecting only `worker-YYYY-MM-DD.log` would fail to recognize or clean up numbered backups (`.N.log`).
5. **Untestable Hard-Coded Constants**: Thresholds (5 MB) and paths were hardcoded, making it impossible for unit tests to verify rotation without writing 5 MB of data.

## Fix Applied

### 1. Cascade Size-Based Rotation Scheme
Implemented `rotateFilesSync()` and `rotateLogFile()`:
- When the active file (`worker-YYYY-MM-DD.log`) exceeds `maxSizeBytes`, it is renamed to `worker-YYYY-MM-DD.1.log`.
- Existing numbered backups shift up by one (`.1.log` becomes `.2.log`, `.2.log` becomes `.3.log`).
- The oldest backup (`.3.log`, governed by `MAX_BACKUPS = 3`) is deleted when `maxBackups` is exceeded.
- Before rotating files, the active stream is ended and flushed via `waitForStreamEnd()` to prevent stream write races and file locking issues during rename.
- After rotation, the active log file is re-created fresh, and in-memory size tracking resets to 0.

### 2. Cheap In-Memory Size Tracking
- `this.currentSize` is seeded once during logger initialization using `statSync` (or `0` if the file does not exist yet).
- Each call to `log()` calculates `Buffer.byteLength(line, 'utf8')` and queues the write.
- When writing a line, `this.currentSize` is checked against `maxSizeBytes`. If adding the line exceeds the limit, rotation triggers before writing.
- `this.currentSize += lineBytes` is updated in memory without performing synchronous filesystem stats on every write.

### 3. Asynchronous Write Serialization & Stream Safety
- Implemented `writeChain: Promise<void>` to serialize file writes and rotation, ensuring log line order is preserved even with stream rotation.
- Added `async close(): Promise<void>` so applications and tests can wait until all pending writes and stream flushes reach disk.
- Ensured no lines are lost during rotation: if rotation fails or stream re-opening fails, error handling re-opens the append stream and writes incoming lines to the current file.

### 4. Robust Error Handling (No Throws to Callers)
- All filesystem operations (`createWriteStream`, `renameSync`, `unlinkSync`, `mkdirSync`) are wrapped in `try/catch`.
- On filesystem failure, the error is caught, reported via `console.error`, and execution safely falls back to standard console logging and retries stream recovery.
- Callers of `logger.info()`, `logger.error()`, etc., will never have exceptions thrown into their execution context from logging failures.

### 5. Daily Rotation and Retention Cleanup Compatibility
- Integrated `cleanupOldLogFiles()` into `SimpleConsoleLogger` initialization to match the 14-day retention policy of the main-thread Winston logger (`LOG_RETENTION_DAYS = 14`).
- Updated filename matching regex to `/^(?:[a-zA-Z0-9_-]+-)?(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$/`, ensuring both active daily logs and numbered backups (`.N.log`) are cleaned up when expired, without crashing or skipping backups.

### 6. Configurable & Testable
- Defined `SimpleConsoleLoggerOptions` supporting optional `logDir`, `maxSizeBytes`, `maxBackups`, and `silent` overrides.
- Allows test suites to configure a 1-byte limit and temporary test directory to verify multi-backup rotation cascades instantaneously without writing megabytes of dummy data.

### 7. Code Comment Preservation
- Preserved the existing `// TODO: Implement proper log rotation` comment and all surrounding explanatory comments, adding clear documentation on the implemented size-based rotation mechanism.

## Tests

1. **`src/tests/main/logger.test.ts`**:
   - `rotates the active file when the limit is passed and preserves every line`: Verifies that exceeding `maxSizeBytes` produces `.1.log` and `.2.log`, preserving all lines across rotated files with zero line loss.
   - `keeps only maxBackups files and deletes the oldest backup`: Verifies backup count capping at `maxBackups` (e.g. 2 backups), confirming that the oldest files are unlinked and no extra backups are created.
   - `does not rotate while the active file stays under the limit`: Confirms that normal writes under the byte limit remain in the single active log file.
   - `cleanup deletes expired daily files and their numbered backups`: Verifies that files older than 14 days (both plain daily logs and `.N.log` backups) are unlinked while recent files are retained.

2. **`src/tests/main/logger-size-rotation-failure.test.ts`**:
   - `does not throw into callers when a rotation rename fails`: Mocks `renameSync` to throw an error (`EPERM`), asserting that `logger.info` never throws, logs the error via `console.error`, and safely retains lines in the active log.
   - `does not throw into callers when unlinking the oldest backup fails`: Mocks `unlinkSync` to throw (`EACCES`), asserting that logger methods do not throw and log to `console.error`.
   - `does not throw into callers when createWriteStream fails`: Mocks `createWriteStream` to throw (`EMFILE`), asserting safe fallback without throwing into caller.

## Verification

All validation commands passed:
- `bun run test` - 104 test files passed (1907 tests, 25 todo)
- `bun run lint` - 0 errors, 0 warnings
- `bun run type-check` - TypeScript passed with no errors (`tsc --noEmit`)
- `bun run package:local` - Successfully built Vite packages and Linux AppImage bundle
