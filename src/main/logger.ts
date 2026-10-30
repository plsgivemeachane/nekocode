import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { isMainThread } from 'worker_threads'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from 'fs'
import type * as Winston from 'winston'

// App name for constructing user data path in worker threads
// Must match the name in package.json
const APP_NAME = 'nekocode'

// Default size threshold for size-based rotation of the active daily log file.
// Once the daily file grows past this many bytes it is rotated into numbered
// backups (worker-YYYY-MM-DD.1.log, .2.log, ...) so one day's log cannot grow
// without limit.
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const DEFAULT_MAX_LOG_SIZE_BYTES = MAX_LOG_SIZE_BYTES

// How many numbered size-rotation backups are kept per daily file. The oldest
// backup is deleted when this limit is exceeded.
const MAX_BACKUPS = 3
const DEFAULT_MAX_LOG_BACKUPS = MAX_BACKUPS

// Daily worker log files (and their numbered backups) older than this many days
// are removed during logger initialization. Matches the winston main-thread
// retention window (maxFiles: '14d').
const LOG_RETENTION_DAYS = 14

// Options mainly used by tests to point the logger at a temp directory and use
// tiny size limits instead of writing megabytes to disk.
export interface SimpleConsoleLoggerOptions {
  // Override the log directory (defaults to the worker log directory)
  logDir?: string
  // Byte limit before the active daily file is rotated
  maxSizeBytes?: number
  // Number of numbered backups kept per daily file
  maxBackups?: number
  // Force logging on/off instead of relying on NODE_ENV
  silent?: boolean
}

// Type definitions for logger interface
type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly'

// Simple file + console logger for worker threads that doesn't depend on winston
// This avoids module resolution issues in packaged Electron apps
// Methods use 'any' for meta to match winston's permissive interface
/* eslint-disable @typescript-eslint/no-explicit-any */
export class SimpleConsoleLogger {
  private fileStream: ReturnType<typeof createWriteStream> | null = null
  // File writes and size rotations run in order on this promise chain. Streams
  // open asynchronously, so rotation must wait for buffered lines to flush
  // before renaming; chaining keeps every line in the correct file and lets
  // close() wait for all pending work.
  private writeChain: Promise<void> = Promise.resolve()
  private closed = false
  private logFilePath: string | null = null
  private logDir: string | null = null
  private static globalLogFileInit = false
  // Silences all console + file logging when running in test environment
  private readonly isSilent: boolean = process.env.NODE_ENV === 'test'
  // Number of bytes currently in the active daily log file. Tracked in memory
  // and seeded once with statSync when the file is opened, so each write only
  // adds the byte length of the line it just wrote instead of calling stat.
  private currentSize = 0
  private readonly maxSizeBytes: number
  private readonly maxBackups: number

  constructor(private label: string, private readonly options: SimpleConsoleLoggerOptions = {}) {
    // Options win over the NODE_ENV default so tests can force file logging on
    this.isSilent = options.silent ?? process.env.NODE_ENV === 'test'
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_LOG_SIZE_BYTES
    this.maxBackups = options.maxBackups ?? DEFAULT_MAX_LOG_BACKUPS
    this.initFileLogging()
  }

  /**
   * Get the user data directory for worker threads.
   * In worker threads, Electron's app API is not available,
   * so we construct the path using environment variables.
   */
  private getWorkerLogDir(): string {
    // Try to use the same logic as the main thread's getLogDir()
    // by constructing the user data path from environment variables
    
    // Windows: %APPDATA%\nekocode\logs
    // macOS: ~/Library/Application Support/nekocode/logs
    // Linux: ~/.config/nekocode/logs
    
    const platform = process.platform
    
    if (platform === 'win32') {
      // Windows: use APPDATA environment variable
      const appData = process.env.APPDATA
      if (appData) {
        return join(appData, APP_NAME, 'logs')
      }
    } else if (platform === 'darwin') {
      // macOS: use HOME environment variable
      const home = process.env.HOME || homedir()
      return join(home, 'Library', 'Application Support', APP_NAME, 'logs')
    } else {
      // Linux and others: use XDG_CONFIG_HOME or HOME
      const configHome = process.env.XDG_CONFIG_HOME || join(process.env.HOME || homedir(), '.config')
      return join(configHome, APP_NAME, 'logs')
    }
    
    // Fallback to temp directory if we can't determine the user data path
    return join(tmpdir(), `${APP_NAME}-worker-logs`)
  }

  private initFileLogging(): void {
    // Skip file logging initialization in test environment to avoid writing log files during tests
    if (this.isSilent) return

    // Initialize file logging for workers - writes to same directory as main thread
    // This ensures workers have file-based logging even in production
    try {
      // Honour the test override first, then fall back to the worker log dir
      this.logDir = this.options.logDir ?? this.getWorkerLogDir()
      // Ensure directory exists
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true })
      }

      // Delete expired daily files before we start appending to today's file.
      // This also removes the numbered size-rotation backups (.N.log).
      this.cleanupOldLogFiles()

      // Use date-based log file name for rotation (one file per day)
      const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
      this.logFilePath = join(this.logDir, `worker-${date}.log`)

      // Seed in-memory size tracking with a single statSync when the file is
      // opened. Writes never stat again; they just add Buffer.byteLength.
      this.currentSize = this.getFileSize()

      // Check if we need to rotate (file size > 5MB)
      // No line is pending here, so this only catches a file that was already oversized on startup.
      // No stream exists yet, so the synchronous rename is safe here.
      if (this.currentSize > this.maxSizeBytes) {
        try {
          this.rotateFilesSync()
          this.currentSize = 0
        } catch (error) {
          // Startup rotation is best effort: keep appending to the current file
          console.error('[logger] startup size-based log rotation failed', error)
        }
      }

      // Create write stream in append mode
      this.openStream()

      // Log initialization message once
      if (!SimpleConsoleLogger.globalLogFileInit) {
        SimpleConsoleLogger.globalLogFileInit = true
        const initMsg = this.formatMessage('info', `Worker logger initialized: ${this.logFilePath}`)
        console.log(initMsg)
      }
    } catch {
      // If file logging fails, fall back to console-only
      this.fileStream = null
    }
  }

  // Create the append stream for the current daily file and swallow stream
  // errors so a broken log file can never crash the worker.
  private openStream(): void {
    if (!this.logFilePath) return

    try {
      // Create write stream in append mode
      this.fileStream = createWriteStream(this.logFilePath, {
        flags: 'a',
        encoding: 'utf8',
      })

      // Handle stream errors silently to prevent crashes
      this.fileStream.on('error', () => {
        this.fileStream = null
      })
    } catch (error) {
      console.error('[logger] failed to open log file stream', error)
      this.fileStream = null
    }
  }

  // Re-open the append stream after a rotation (or after a failed rotation)
  // without ever throwing into the caller.
  private ensureStream(): void {
    if (this.fileStream) return
    try {
      this.openStream()
    } catch (error) {
      console.error('[logger] failed to reopen log stream after rotation', error)
      this.fileStream = null
    }
  }

  // Read the current daily file size exactly once (used at initialization).
  private getFileSize(): number {
    if (!this.logFilePath) return 0
    try {
      return statSync(this.logFilePath).size
    } catch {
      return 0
    }
  }

  // Build the numbered backup path for the active daily file, e.g.
  // worker-2024-01-01.log + 2 -> worker-2024-01-01.2.log
  private getBackupPath(index: number): string {
    if (!this.logFilePath) return ''
    return `${this.logFilePath.replace(/\.log$/, '')}.${index}.log`
  }

  // Delete daily worker logs (including numbered backups) older than the
  // retention window. Filename matching accepts both worker-YYYY-MM-DD.log and
  // worker-YYYY-MM-DD.N.log so backups are cleaned up and never crash cleanup.
  private cleanupOldLogFiles(): void {
    if (!this.logDir) return
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
      for (const entry of readdirSync(this.logDir)) {
        // Match the daily file and any numbered size-rotation backup
        const match = /^(?:[a-zA-Z0-9_-]+-)?(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$/.exec(entry)
        if (!match) continue
        const fileDate = Date.parse(`${match[1]}T00:00:00.000Z`)
        // Keep unparsable or not-yet-expired files
        if (Number.isNaN(fileDate) || fileDate >= cutoff) continue
        try {
          unlinkSync(join(this.logDir, entry))
        } catch {
          // A single undeletable file must not abort cleanup of the rest
        }
      }
    } catch {
      // Cleanup is best effort; never throw into callers
    }
  }

  // Rename cascade used by size rotation: delete the oldest backup, shift the
  // rest up by one and move the active daily file to .1.log. Callers must have
  // flushed and closed the active stream first so the rename sees a stable
  // file. Filesystem errors are caught by the callers, never thrown to loggers.
  private rotateFilesSync(): void {
    if (!this.logFilePath) return

    if (this.maxBackups < 1) {
      if (existsSync(this.logFilePath)) {
        unlinkSync(this.logFilePath)
      }
      return
    }

    // Delete the oldest backup, then shift the remaining ones up by one
    const oldest = this.getBackupPath(this.maxBackups)
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let index = this.maxBackups - 1; index >= 1; index--) {
      const from = this.getBackupPath(index)
      if (existsSync(from)) renameSync(from, this.getBackupPath(index + 1))
    }

    // Move the active daily file to .1
    if (existsSync(this.logFilePath)) renameSync(this.logFilePath, this.getBackupPath(1))
  }

  // Rotate worker-YYYY-MM-DD.log -> .1.log, .1 -> .2, ... and delete the
  // oldest backup. The stream is closed first so the rename does not race
  // pending writes; the incoming line is written after this returns.
  private async rotateLogFile(): Promise<void> {
    if (!this.logFilePath) return

    // Close the current stream first so the rename sees a stable file. Ending
    // the stream waits for its buffered lines to reach disk before the rename,
    // which keeps every line in either the backup or the fresh daily file.
    const stream = this.fileStream
    this.fileStream = null
    if (stream) {
      await this.waitForStreamEnd(stream, true)
    }

    this.rotateFilesSync()

    // The freshly opened file starts empty again
    this.currentSize = 0
    this.ensureStream()
  }

  private async maybeRotateLogFile(incomingBytes = 0): Promise<void> {
    if (!this.logFilePath) return
    // TODO: Implement proper log rotation
    // For now, we just let the file grow until the next day
    // Daily rotation by filename already provides basic rotation
    // Size-based rotation is now implemented: when the active daily file would
    // pass maxSizeBytes it becomes .1.log, .1 becomes .2 and so on, keeping
    // maxBackups numbered files and deleting the oldest.
    try {
      // Nothing is written to disk in silent mode, so never rotate
      if (this.isSilent) return
      // Nothing written yet to this file, so there is nothing to rotate
      if (this.currentSize <= 0) return
      // Still within the limit: no rotation needed (cheap in-memory check)
      if (this.currentSize + incomingBytes <= this.maxSizeBytes) return
      await this.rotateLogFile()
    } catch (error) {
      // File doesn't exist or can't stat, that's fine
      // Never throw into callers: report and keep appending to the current file
      console.error('[logger] size-based log rotation failed', error)
      this.ensureStream()
    }
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\..+/, '')
    const metaStr = meta && typeof meta === 'object' && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
    return `${timestamp} [${this.label}] ${level}: ${message}${metaStr}`
  }

  private log(level: LogLevel, message: string, meta?: any): void {
    // Skip all logging when in test environment (keeps vitest output clean)
    if (this.isSilent) return

    const formatted = this.formatMessage(level, message, meta)

    // Always log to console (useful in development)
    if (level === 'error') console.error(formatted)
    else if (level === 'warn') console.warn(formatted)
    else console.log(formatted)

    // Also write to file if available (critical for production)
    if (this.closed || !this.logFilePath) return

    const line = formatted + '\n'
    // Byte length matches on-disk size so size tracking stays accurate
    const lineBytes = Buffer.byteLength(line, 'utf8')

    // Queue the file write (and any rotation it needs) behind earlier writes so
    // order is preserved even though streams open asynchronously. Errors are
    // reported to the console instead of being thrown into the caller.
    this.writeChain = this.writeChain
      .then(() => this.writeLine(line, lineBytes))
      .catch((error) => {
        console.error('[logger] failed to write log line', error)
        this.ensureStream()
      })
  }

  // Write one line, rotating first when the line would push the active file
  // past the configured limit. Runs on the write chain, so every earlier line
  // has already been written when a rotation starts.
  private async writeLine(line: string, lineBytes: number): Promise<void> {
    if (!this.logFilePath) return
    this.ensureStream()

    // Rotate BEFORE the write when this line would pass the limit, so every
    // line ends up in either the rotated backup or the new daily file.
    await this.maybeRotateLogFile(lineBytes)

    // Rotation may have replaced the stream; only write if it is usable.
    // On rotation failure the old stream is reopened so no line is lost.
    if (this.fileStream && this.fileStream.writable) {
      try {
        this.fileStream.write(line)
        // Cheap in-memory accounting, no stat per write
        this.currentSize += lineBytes
      } catch (error) {
        console.error('[logger] failed to write to log stream', error)
      }
    }
  }

  // Flush and close the file stream (graceful shutdown and tests)
  // Returns a promise so callers (and tests) can wait until every buffered
  // line, including lines waiting in the write chain and the line that just
  // triggered a rotation, has been flushed to disk.
  async close(): Promise<void> {
    // Stop accepting new lines, then wait for everything already queued
    this.closed = true
    try {
      await this.writeChain
    } catch {
      // The chain already reports failures to the console; close never throws
    }

    // End the active stream so its buffered lines are flushed too
    const current = this.fileStream
    this.fileStream = null
    if (current) {
      await this.waitForStreamEnd(current, true)
    }
  }

  // Resolve once a stream finished flushing (or failed). Never rejects so a
  // broken log file cannot make close() or rotation throw into callers.
  private waitForStreamEnd(
    stream: ReturnType<typeof createWriteStream>,
    endIt: boolean,
  ): Promise<void> {
    if (stream.writableFinished || stream.destroyed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = (): void => resolve()
      stream.once('finish', done)
      stream.once('error', done)
      stream.once('close', done)
      if (!endIt) return
      try {
        stream.end()
      } catch {
        resolve()
      }
    })
  }

  error(message: string, meta?: any): void { this.log('error', message, meta) }
  warn(message: string, meta?: any): void { this.log('warn', message, meta) }
  info(message: string, meta?: any): void { this.log('info', message, meta) }
  http(message: string, meta?: any): void { this.log('http', message, meta) }
  verbose(message: string, meta?: any): void { this.log('verbose', message, meta) }
  debug(message: string, meta?: any): void { this.log('debug', message, meta) }
  silly(message: string, meta?: any): void { this.log('silly', message, meta) }

  // Compatibility with winston logger interface
  child(meta: { label?: string }): SimpleConsoleLogger {
    // For workers, just return a new logger with the label
    // Options are forwarded so test overrides (log dir, size limits) survive
    return new SimpleConsoleLogger(meta.label || this.label, this.options)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Winston imports and configuration only for main thread
// Runtime imports are conditional - only load winston in main thread
let winston: typeof Winston | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DailyRotateFile: any = null

if (isMainThread) {
  // Only import winston in the main thread to avoid worker module resolution issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  winston = require('winston')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DailyRotateFile = require('winston-daily-rotate-file')
}

// In worker threads, Electron's app API is not available.
// Use temp directory as fallback for logging.
// Lazy initialization to avoid importing electron in worker threads.
let _logDir: string | null = null
function getLogDir(): string {
  if (_logDir === null) {
    if (isMainThread) {
      try {
        // Dynamic import electron only in main thread
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app } = require('electron')
        // app may be undefined in test environments or non-Electron contexts
        _logDir = app ? join(app.getPath('userData'), 'logs') : join(tmpdir(), 'nekocode-logs')
      } catch {
        // Electron not available (e.g., in test environment)
        _logDir = join(tmpdir(), 'nekocode-logs')
      }
    } else {
      _logDir = join(tmpdir(), 'nekocode-worker-logs')
    }
  }
  return _logDir
}

// In worker threads, default to development mode for more verbose logging
// Lazy initialization to avoid importing electron in worker threads.
let _isDev: boolean | null = null
function getIsDev(): boolean {
  if (_isDev === null) {
    if (isMainThread) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app } = require('electron')
        // app may be undefined in test environments or non-Electron contexts
        _isDev = app ? !app.isPackaged : true
      } catch {
        // Electron not available (e.g., in test environment)
        _isDev = true
      }
    } else {
      _isDev = true
    }
  }
  return _isDev
}

// Create transports and logger only in main thread
let rootLogger: Winston.Logger | null = null

if (winston && DailyRotateFile) {
  const { combine, timestamp, printf, colorize, json } = winston.format

  const consoleFormat = combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ timestamp, level, message, label, ...meta }) => {
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
      return `${timestamp} [${label}] ${level}: ${message}${metaStr}`
    }),
  )

  const fileFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    json(),
  )

  // Silence individual transports in test env (not the logger itself).
  // Setting silent on the logger blocks child loggers from ever emitting
  // because Winston's child().write() delegates to the parent's _transform,
  // which checks the parent's silent flag. Transport-level silent is checked
  // inside each transport's own log() method, so it does not block custom
  // transports added by child loggers in tests.
  const isTest = process.env.NODE_ENV === 'test'

  const transports: Winston.transport[] = [
    new winston.transports.Console({
      level: getIsDev() ? 'debug' : 'warn',
      format: consoleFormat,
      silent: isTest,
    }),
    new winston.transports.File({
      dirname: getLogDir(),
      filename: 'combined.log',
      level: 'info',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      silent: isTest,
    }),
    new winston.transports.File({
      dirname: getLogDir(),
      filename: 'error.log',
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      silent: isTest,
    }),
    new DailyRotateFile({
      dirname: getLogDir(),
      filename: 'nekocode-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      format: fileFormat,
      maxFiles: '14d',
      silent: isTest,
    }),
  ]

  rootLogger = winston.createLogger({
    level: 'debug',
    transports,
    exitOnError: false,
  })
}

// Export a union type that both loggers satisfy
export type Logger = Winston.Logger | SimpleConsoleLogger

export function createLogger(moduleLabel: string): Logger {
  // In worker threads, use the simple console logger to avoid winston dependency
  if (!isMainThread || !rootLogger) {
    return new SimpleConsoleLogger(moduleLabel)
  }
  // In main thread, use winston
  return rootLogger.child({ label: moduleLabel })
}
