import type { ExtensionLoadError } from '../../../shared/ipc-types'
import { createLogger } from './logger'

const logger = createLogger('extension-logging')

/**
 * Log extension load warnings from session creation/reconnection.
 * Optionally dispatches an error status if extensions are not fully disabled.
 */
export function logExtensionLoadWarnings(
  mode: 'create' | 'reconnect',
  sessionId: string,
  errors: ExtensionLoadError[] | undefined,
  extensionsDisabled: boolean | undefined,
  onError?: (sessionId: string) => void,
): void {
  if (!errors || errors.length === 0) return
  if (extensionsDisabled) {
    logger.warn(`[${mode}] sessionId=${sessionId.slice(0, 8)}... running in degraded mode (extensions disabled)`)
  }
  logger.warn(`[${mode}] sessionId=${sessionId.slice(0, 8)}... extension load errors=${errors.length}`)
  for (const error of errors) {
    logger.warn(`[${mode}] path=${error.path} message=${error.message}`)
    if (error.stack) {
      logger.debug(`[${mode}] stack for ${error.path}:\n${error.stack}`)
    }
  }
  if (!extensionsDisabled) {
    onError?.(sessionId)
  }
}
