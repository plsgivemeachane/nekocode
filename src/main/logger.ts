import { join } from 'path'
import { tmpdir } from 'os'
import { isMainThread } from 'worker_threads'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

const { combine, timestamp, printf, colorize, json } = winston.format

// In worker threads, Electron's app API is not available.
// Use temp directory as fallback for logging.
// Lazy initialization to avoid importing electron in worker threads.
let _logDir: string | null = null
function getLogDir(): string {
  if (_logDir === null) {
    if (isMainThread) {
      try {
        // Dynamic import electron only in main thread
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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

// In worker threads, default to development mode for more verbose logging
// Lazy initialization to avoid importing electron in worker threads.
let _isDev: boolean | null = null
function getIsDev(): boolean {
  if (_isDev === null) {
    if (isMainThread) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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

const transports: winston.transport[] = [
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

const rootLogger = winston.createLogger({
  level: 'debug',
  transports,
  exitOnError: false,
})

export type Logger = winston.Logger

export function createLogger(moduleLabel: string): Logger {
  return rootLogger.child({ label: moduleLabel })
}
