import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { isMainThread } from 'worker_threads'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs'
import type * as Winston from 'winston'

// App name for constructing user data path in worker threads
// Must match the name in package.json
const APP_NAME = 'nekocode'

// Type definitions for logger interface
type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly'

// Simple file + console logger for worker threads that doesn't depend on winston
// This avoids module resolution issues in packaged Electron apps
// Methods use 'any' for meta to match winston's permissive interface
/* eslint-disable @typescript-eslint/no-explicit-any */
class SimpleConsoleLogger {
  private fileStream: ReturnType<typeof createWriteStream> | null = null
  private logFilePath: string | null = null
  private static globalLogFileInit = false

  constructor(private label: string) {
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
    // Initialize file logging for workers - writes to same directory as main thread
    // This ensures workers have file-based logging even in production
    try {
      const logDir = this.getWorkerLogDir()
      // Ensure directory exists
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true })
      }

      // Use date-based log file name for rotation (one file per day)
      const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
      this.logFilePath = join(logDir, `worker-${date}.log`)

      // Check if we need to rotate (file size > 5MB)
      this.maybeRotateLogFile()

      // Create write stream in append mode
      this.fileStream = createWriteStream(this.logFilePath, {
        flags: 'a',
        encoding: 'utf8',
      })

      // Handle stream errors silently to prevent crashes
      this.fileStream.on('error', () => {
        this.fileStream = null
      })

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

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\..+/, '')
    const metaStr = meta && typeof meta === 'object' && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
    return `${timestamp} [${this.label}] ${level}: ${message}${metaStr}`
  }

  private log(level: LogLevel, message: string, meta?: any): void {
    const formatted = this.formatMessage(level, message, meta)

    // Always log to console (useful in development)
    if (level === 'error') console.error(formatted)
    else if (level === 'warn') console.warn(formatted)
    else console.log(formatted)

    // Also write to file if available (critical for production)
    if (this.fileStream && this.fileStream.writable) {
      this.fileStream.write(formatted + '\n')
    }
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
    return new SimpleConsoleLogger(meta.label || this.label)
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

  const transports: Winston.transport[] = [
    new winston.transports.Console({
      level: getIsDev() ? 'debug' : 'warn',
      format: consoleFormat,
    }),
    new winston.transports.File({
      dirname: getLogDir(),
      filename: 'combined.log',
      level: 'info',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      dirname: getLogDir(),
      filename: 'error.log',
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new DailyRotateFile({
      dirname: getLogDir(),
      filename: 'nekocode-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      format: fileFormat,
      maxFiles: '14d',
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
