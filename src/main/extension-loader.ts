import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type AgentSession,
  type SessionManager as SdkSessionManager,
} from '@mariozechner/pi-coding-agent'
import type { ExtensionLoadError } from '../shared/ipc-types'
import { createLogger } from './logger'

const logger = createLogger('extension-loader')

export interface ExtensionLoadResult {
  session: AgentSession
  extensionsResult: Awaited<ReturnType<typeof createAgentSession>>['extensionsResult']
}

/**
 * Create an SDK session with the given session manager and options.
 * Handles resource loader creation and the reload step.
 */
export async function createSdkSession(
  sessionManager: SdkSessionManager,
  cwd: string,
  mode: 'create' | 'create-noext' | 'reconnect' | 'reconnect-noext',
  loaderOptions?: { noExtensions?: boolean },
): Promise<ExtensionLoadResult> {
  const loader = createResourceLoader(cwd, loaderOptions)
  logger.debug(`[${mode}] createSdkSession loaderCwd=${cwd} processCwd=${process.cwd()} NODE_PATH=${process.env.NODE_PATH ?? ''}`)
  await loader.reload()
  const result = await createAgentSession({
    cwd,
    resourceLoader: loader,
    sessionManager,
  })
  return { session: result.session, extensionsResult: result.extensionsResult }
}

/**
 * Create a resource loader for the given working directory.
 */
export function createResourceLoader(cwd: string, options?: { noExtensions?: boolean }): DefaultResourceLoader {
  return new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    settingsManager: SettingsManager.create(),
    noExtensions: options?.noExtensions,
  })
}

/**
 * Detect the systemic extension loader failure signature where all extensions fail
 * with the same message containing '(void 0) is not a function'.
 * In this case, retrying without extensions is likely to succeed.
 */
export function shouldRetryWithoutExtensions(errors: ExtensionLoadError[], loadedExtensionsCount: number): boolean {
  if (loadedExtensionsCount > 0 || errors.length === 0) return false
  const uniqueMessages = new Set(errors.map(error => error.message))
  if (uniqueMessages.size !== 1) return false
  const onlyMessage = errors[0]?.message ?? ''
  return onlyMessage.includes('(void 0) is not a function')
}

/**
 * Normalize raw SDK extension errors into the ExtensionLoadError shape.
 * Handles string errors, object errors with path/message/stack, and unknown types.
 */
export function normalizeExtensionErrors(errors: unknown[]): ExtensionLoadError[] {
  return errors.map((error, index) => {
    if (typeof error === 'string') {
      return { path: `unknown:${index}`, message: error }
    }

    if (error && typeof error === 'object') {
      const path = 'path' in error && typeof error.path === 'string' ? error.path : `unknown:${index}`
      const message = 'error' in error && typeof error.error === 'string'
        ? error.error
        : 'message' in error && typeof error.message === 'string'
          ? error.message
          : String(error)
      const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
      return { path, message, stack }
    }

    return { path: `unknown:${index}`, message: String(error) }
  })
}

/**
 * Log extension load errors with structured diagnostics.
 * Marker-only errors (path=__create__ or __reconnect__) are logged as warnings.
 * Real errors get error-level logging with fingerprint detection.
 */
export function logExtensionErrors(mode: 'create' | 'reconnect', errors: ExtensionLoadError[]): void {
  if (errors.length === 0) return
  const markerOnly = errors.every(error => error.path === '__reconnect__' || error.path === '__create__')
  if (markerOnly) {
    for (const extensionError of errors) {
      logger.warn(`[${mode}] ${extensionError.message}`)
    }
    return
  }
  logger.error(`[${mode}] Extension load errors (${errors.length})`)
  const uniqueMessages = new Set(errors.map(error => error.message))
  if (uniqueMessages.size === 1) {
    logger.error(`[${mode}] Extension error fingerprint: uniform-message across all failures -> ${errors[0].message}`)
  }
  const stackCount = errors.filter(error => !!error.stack).length
  if (stackCount === 0) {
    logger.error(`[${mode}] Extension diagnostics: no stack traces provided by SDK error payload`)
  }
  for (const extensionError of errors) {
    logger.error(`[${mode}] Extension load error path=${extensionError.path} message=${extensionError.message}`)
    if (extensionError.stack) {
      logger.error(`[${mode}] Extension load stack path=${extensionError.path}\n${extensionError.stack}`)
    }
  }
}

export interface LoadWithFallbackResult {
  session: AgentSession
  extensionsResult: ExtensionLoadResult['extensionsResult']
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
}

/**
 * Unified extension loading with fallback logic.
 * Deduplicates the retry-without-extensions pattern used by both create() and reconnect().
 *
 * @param mode - 'create' or 'reconnect' for logging/marker context
 * @param getSdkSessionManager - Factory to obtain a fresh SdkSessionManager (called twice if fallback needed)
 * @param cwd - Working directory for the session
 * @param allowExtensionFallback - Whether to allow degraded mode without extensions
 */
export async function loadWithFallback(
  mode: 'create' | 'reconnect',
  getSdkSessionManager: () => SdkSessionManager | Promise<SdkSessionManager>,
  cwd: string,
  allowExtensionFallback: boolean,
): Promise<LoadWithFallbackResult> {
  const sdkSessionManager = await getSdkSessionManager()
  const primaryAttempt = await createSdkSession(sdkSessionManager, cwd, mode)
  const primaryErrors = normalizeExtensionErrors(primaryAttempt.extensionsResult.errors)

  let session = primaryAttempt.session
  let extensionsResult = primaryAttempt.extensionsResult
  let extensionErrors = primaryErrors
  let extensionsDisabled = false

  if (shouldRetryWithoutExtensions(primaryErrors, primaryAttempt.extensionsResult.extensions.length)) {
    if (!allowExtensionFallback) {
      logExtensionErrors(mode, primaryErrors)
      throw new Error(`[${mode}] Systemic extension loader failure (${primaryErrors.length}) - set NEKOCODE_ALLOW_EXTENSION_FALLBACK=1 to allow degraded reconnect/create without extensions`)
    }
    logger.warn(`[${mode}] Detected systemic extension loader failure signature, retrying with extensions disabled`)
    const retrySdkSessionManager = await getSdkSessionManager()
    const retryAttempt = await createSdkSession(retrySdkSessionManager, cwd, `${mode}-noext`, { noExtensions: true })
    session = retryAttempt.session
    extensionsResult = retryAttempt.extensionsResult
    extensionsDisabled = retryAttempt.extensionsResult.errors.length === 0
    if (extensionsDisabled) {
      logger.warn(`[${mode}] Primary extension load failed (${primaryErrors.length}); fallback without extensions succeeded`)
      extensionErrors = [
        {
          path: `__${mode}__`,
          message: `${mode.charAt(0).toUpperCase() + mode.slice(1)} fallback engaged: extensions disabled for this session due to systemic extension loader failure (primaryErrors=${primaryErrors.length})`,
        },
      ]
    } else {
      extensionErrors = [
        ...primaryErrors,
        ...normalizeExtensionErrors(retryAttempt.extensionsResult.errors),
        {
          path: `__${mode}__`,
          message: `${mode.charAt(0).toUpperCase() + mode.slice(1)} fallback attempted with extensions disabled but still encountered extension load errors`,
        },
      ]
    }
  }

  logExtensionErrors(mode, extensionErrors)
  logger.info(`[${mode}] Extensions loaded: ${extensionsResult.extensions.length}, errors: ${extensionsResult.errors.length}`)
  for (const ext of extensionsResult.extensions) {
    logger.info(`[${mode}] Extension: ${ext.path}`)
  }

  return { session, extensionsResult, extensionErrors, extensionsDisabled }
}
