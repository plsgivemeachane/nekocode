/// <reference types="vite/client" />

const isDev = import.meta.env.DEV
// Silences all logging when running in test environment (keeps vitest output clean)
const isTest = process.env.NODE_ENV === 'test'

export interface Logger {
  error(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  debug(message: string, ...meta: unknown[]): void
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23)
}

export function createLogger(moduleLabel: string): Logger {
  const prefix = `[${moduleLabel}]`

  return {
    error(message: string, ...meta: unknown[]) {
      if (isTest || !isDev) return
      console.error(`${formatTimestamp()} ${prefix} error: ${message}`, ...meta)
    },
    warn(message: string, ...meta: unknown[]) {
      if (isTest || !isDev) return
      console.warn(`${formatTimestamp()} ${prefix} warn: ${message}`, ...meta)
    },
    info(message: string, ...meta: unknown[]) {
      if (isTest || !isDev) return
      console.log(`${formatTimestamp()} ${prefix} info: ${message}`, ...meta)
    },
    debug(message: string, ...meta: unknown[]) {
      if (isTest || !isDev) return
      console.log(`${formatTimestamp()} ${prefix} debug: ${message}`, ...meta)
    },
  }
}
