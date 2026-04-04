import { app } from 'electron'
import { join } from 'path'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

const { combine, timestamp, printf, colorize, json } = winston.format

const logDir = join(app.getPath('userData'), 'logs')

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

const isDev = !app.isPackaged

const transports: winston.transport[] = [
  new winston.transports.Console({
    level: isDev ? 'debug' : 'warn',
    format: consoleFormat,
  }),
  new winston.transports.File({
    dirname: logDir,
    filename: 'combined.log',
    level: 'info',
    format: fileFormat,
    maxsize: 5 * 1024 * 1024,
    maxFiles: 5,
  }),
  new winston.transports.File({
    dirname: logDir,
    filename: 'error.log',
    level: 'error',
    format: fileFormat,
    maxsize: 5 * 1024 * 1024,
    maxFiles: 5,
  }),
  new DailyRotateFile({
    dirname: logDir,
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
