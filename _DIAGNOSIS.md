# Forensic Diagnosis: Winston Capture Transport Receives Zero Logs (7 Test Failures)

## 1. The Fracture Point
- **File:** `src/main/logger.ts`
- **Line:** 275
- **Function:** Root logger creation (module-level)
- **Code:** `silent: process.env.NODE_ENV === 'test'`

## 2. The Evidence

### The Call Chain
1. `rootLogger = winston.createLogger({ silent: true })` — `rootLogger.silent = true` (line 275)
2. `createLogger("capture-module")` → `rootLogger.child({ label })` (line 290)
3. Winston `child()` implementation (node_modules/winston/lib/winston/logger.js:45-72):
   ```js
   child(defaultRequestMetadata) {
     const logger = this; // captures rootLogger
     return Object.create(logger, {
       write: {
         value: function (info) {
           // ...
           logger.write(infoClone); // DELEGATES TO PARENT (rootLogger)
         }
       }
     });
   }
   ```
4. Test sets `captureLogger.silent = false` (test line 115) — sets OWN property on child object
5. Test calls `captureLogger.info("capture-test-info")`
6. Execution path: `child.info()` → inherited from prototype → `this.write(info)` → child's overridden `write` → `logger.write(infoClone)` → **rootLogger.write(infoClone)**
7. `rootLogger._transform()` checks `this.silent` where `this === rootLogger` → **`true`** → returns `callback()` early → log is SWALLOWED
8. Capture transport's `log()` callback is NEVER invoked
9. `capturedLogs.length === 0` → assertion fails

### Why `captureLogger.silent = false` Does Not Work
The child object created via `Object.create(logger)` inherits from the parent. Setting `child.silent = false` creates an own property on the child. But `_transform()` runs in the **parent's** stream context (because the child's `write()` delegates to `rootLogger.write()`). The parent's `this.silent` is `true`, so `_transform` short-circuits.

The child's own `silent` property is never consulted.

## 3. All 7 Failures Share This Root Cause
| Test | Line | Same mechanism |
|------|------|----------------|
| info log is captured | 143 | `captureLogger.info()` → swallowed by parent's `silent: true` |
| error log is captured | 150 | Same |
| warn log is captured | 157 | Same |
| log message contains text | 164 | Same |
| log contains label | 171 | Same |
| meta data passed through | 178 | Same |
| child logger with new label | 201 | Same (child's write delegates to parent) |

## 4. Recommended Fix Strategy

**Do NOT set `silent: true` on the root logger. Instead, set `silent: true` on each individual transport.**

In `src/main/logger.ts`, change:

### Before (broken):
```ts
const transports: Winston.transport[] = [
  new winston.transports.Console({ ... }),
  new winston.transports.File({ ... }),
  new winston.transports.File({ ... }),
  new DailyRotateFile({ ... }),
]

rootLogger = winston.createLogger({
  level: 'debug',
  silent: process.env.NODE_ENV === 'test',  // ← THE BUG
  transports,
  exitOnError: false,
})
```

### After (fixed):
```ts
const isTest = process.env.NODE_ENV === 'test'

const transports: Winston.transport[] = [
  new winston.transports.Console({ ..., silent: isTest }),
  new winston.transports.File({ ..., silent: isTest }),
  new winston.transports.File({ ..., silent: isTest }),
  new DailyRotateFile({ ..., silent: isTest }),
]

rootLogger = winston.createLogger({
  level: 'debug',
  // Do NOT set silent here — it blocks child loggers from adding custom transports
  transports,
  exitOnError: false,
})
```

### Why This Works
- Transport-level `silent` is checked inside each transport's `log()` method (`winston-transport` package)
- `_transform()` only checks `this.silent` on the Logger — with it unset (default `false`), logs flow through to all transports
- Default transports (Console, File, DailyRotateFile) are individually silenced in test env → no noise
- When tests add a custom capture transport via `child.add(captureTransport)`, that transport has `silent: false` (default) → receives logs normally
- The test's `captureLogger.silent = false` line becomes a harmless no-op (can optionally be removed)

### Test File Changes
No changes strictly required. The existing test code (`captureLogger.silent = false`) is harmless but no longer necessary. Optionally clean up lines 115 and 186 to remove the now-unnecessary `silent = false` assignments.
