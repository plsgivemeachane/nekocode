# Logger Noise in Test Environment

## Bug Description

When running Vitest tests, both the Winston logger (main thread) and the renderer `createLogger` produced verbose log output that cluttered the test terminal. This made it difficult to identify actual test failures and warnings among the noise.

The Winston logger wrote directly to `process.stdout`/`process.stderr`, bypassing Vitest's `--silent` flag. The renderer logger (`createLogger`) logged to `console.warn`/`console.log` when `import.meta.env.DEV` was `true`, which was the case in the Vitest jsdom environment.

## Root Cause

1. **Winston logger** (`src/main/logger.ts`): Had no `silent` flag for the test environment. Winston transports write directly to stdout/stderr, which Vitest's `--silent` flag does not intercept.

2. **SimpleConsoleLogger** (`src/main/logger.ts`): The worker-thread logger had no environment-aware silencing. It always wrote to both console and file, even during tests.

3. **Renderer logger** (`src/renderer/src/utils/logger.ts`): Only checked `isDev` (`import.meta.env.DEV`) before logging. In Vitest's jsdom environment, `DEV` is `true`, so all logger calls produced console output.

4. **Extension logging tests** (`src/tests/renderer/extension-logging.test.ts`): Tests spied on `console.warn`/`console.log` directly rather than on the logger methods themselves. This created a coupling between the test assertions and the logger's internal implementation (console calls), making it impossible to silence the logger without breaking the tests.

## Fix Applied

### 1. Winston logger - Added `silent` flag for test environment

In `src/main/logger.ts`, added `silent: process.env.NODE_ENV === 'test'` to the `winston.createLogger` configuration. This leverages Winston's built-in silencing mechanism which prevents all transport output.

### 2. SimpleConsoleLogger - Added `isSilent` guard

Added a `readonly isSilent` property that checks `process.env.NODE_ENV === 'test'`, and:
- Early-returns from `log()` method when `isSilent` is true
- Early-returns from `initFileLogging()` when `isSilent` is true (avoids creating log files during tests)

### 3. Renderer logger - Added `isTest` guard

In `src/renderer/src/utils/logger.ts`, added `isTest = process.env.NODE_ENV === 'test'` and updated each log method to early-return when `isTest` is true:

    if (isTest || !isDev) return

### 4. Extension logging tests - Switched to mocking the logger module

Updated `src/tests/renderer/extension-logging.test.ts` to:
- Use `vi.hoisted()` to create a mock logger object with `vi.fn()` methods
- Use `vi.mock()` to replace the logger module with the mock
- Spy on `mockLogger.warn`/`mockLogger.debug` instead of `console.warn`/`console.log`
- This decouples test assertions from the logger's internal implementation

## Files Changed

- `src/main/logger.ts` - Added `silent` flag to Winston and `isSilent` guard to SimpleConsoleLogger
- `src/renderer/src/utils/logger.ts` - Added `isTest` environment check
- `src/tests/renderer/extension-logging.test.ts` - Refactored to mock the logger module instead of spying on console methods

## Verification

- All 619 tests pass
- Lint passes with no errors
- Type-check passes
- Test output is now clean (no logger noise in stdout/stderr)