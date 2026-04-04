/// <reference types="vite/client" />

interface ViteImportMetaEnv {
  DEV?: boolean
  PROD?: boolean
  MODE?: string
}

interface ViteImportMeta extends ImportMeta {
  env: ViteImportMetaEnv
}

const isDev = typeof import.meta !== "undefined" && (import.meta as ViteImportMeta).env?.DEV !== false

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
      if (isDev) console.error(`${formatTimestamp()} ${prefix} error: ${message}`, ...meta)
    },
    warn(message: string, ...meta: unknown[]) {
      if (isDev) console.warn(`${formatTimestamp()} ${prefix} warn: ${message}`, ...meta)
    },
    info(message: string, ...meta: unknown[]) {
      if (isDev) console.log(`${formatTimestamp()} ${prefix} info: ${message}`, ...meta)
    },
    debug(message: string, ...meta: unknown[]) {
      if (isDev) console.log(`${formatTimestamp()} ${prefix} debug: ${message}`, ...meta)
    },
  }
}
