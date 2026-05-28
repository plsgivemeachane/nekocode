/**
 * Secure key store using Electron's safeStorage API.
 *
 * Wraps the Pi SDK's AuthStorageBackend to encrypt API keys and OAuth tokens
 * at rest. When safeStorage is available (all supported platforms), credentials
 * in auth.json are encrypted so they cannot be read by other processes.
 *
 * Security note: safeStorage uses the OS keychain on macOS, DPAPI on Windows,
 * and libsecret on Linux. The encrypted data is machine-specific and cannot
 * be synced between machines.
 *
 * Fallback: If safeStorage is not available (e.g., in tests or headless mode),
 * the wrapper falls back to plaintext storage with a warning. This ensures
 * the app remains functional during development and CI.
 */

import { safeStorage } from 'electron'
import { createLogger } from './logger'
import type { AuthStorageBackend } from '@earendil-works/pi-coding-agent'

const logger = createLogger('secure-key-store')

/** Prefix for encrypted values in the JSON file to distinguish them from plaintext. */
const ENCRYPTED_PREFIX = 'enc:v1:'

/**
 * Check if safeStorage is available and ready for use.
 * safeStorage requires the app to be ready and is only available in the main process.
 */
function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Encrypt a string value using Electron's safeStorage.
 * Returns the encrypted value with a prefix, or the original value if safeStorage is unavailable.
 */
function encryptValue(plaintext: string): string {
  if (!isSafeStorageAvailable()) {
    logger.warn('safeStorage not available — credential stored in plaintext')
    return plaintext
  }
  try {
    const encrypted = safeStorage.encryptString(plaintext)
    // Store as base64 with prefix for identification
    return `${ENCRYPTED_PREFIX}${encrypted.toString('base64')}`
  } catch (error) {
    logger.error(`Failed to encrypt credential: ${error}`)
    return plaintext
  }
}

/**
 * Decrypt a string value that was encrypted by encryptValue.
 * If the value doesn't have the encrypted prefix, it's returned as-is (plaintext fallback).
 */
function decryptValue(maybeEncrypted: string): string {
  if (!maybeEncrypted.startsWith(ENCRYPTED_PREFIX)) {
    // Not encrypted — plaintext fallback (legacy or safeStorage unavailable)
    return maybeEncrypted
  }
  if (!isSafeStorageAvailable()) {
    logger.error('Cannot decrypt credential — safeStorage unavailable. Re-authentication required.')
    throw new Error('Cannot decrypt credential: safeStorage unavailable. Please re-enter your API keys.')
  }
  try {
    const base64 = maybeEncrypted.slice(ENCRYPTED_PREFIX.length)
    const buffer = Buffer.from(base64, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    logger.error(`Failed to decrypt credential: ${error}`)
    throw new Error('Failed to decrypt credential. Please re-enter your API keys.')
  }
}

/**
 * Encrypt all credential values in an auth.json string.
 * Parses the JSON, encrypts the `key` field of `api_key` credentials and
 * relevant OAuth fields, then re-serializes.
 */
function encryptAuthJson(jsonString: string): string {
  try {
    const data = JSON.parse(jsonString)
    for (const provider of Object.keys(data)) {
      const cred = data[provider]
      if (cred && cred.type === 'api_key' && typeof cred.key === 'string') {
        // Don't double-encrypt
        if (!cred.key.startsWith(ENCRYPTED_PREFIX)) {
          cred.key = encryptValue(cred.key)
        }
      }
      // OAuth tokens are also sensitive
      if (cred && cred.type === 'oauth') {
        if (typeof cred.accessToken === 'string' && !cred.accessToken.startsWith(ENCRYPTED_PREFIX)) {
          cred.accessToken = encryptValue(cred.accessToken)
        }
        if (typeof cred.refreshToken === 'string' && !cred.refreshToken.startsWith(ENCRYPTED_PREFIX)) {
          cred.refreshToken = encryptValue(cred.refreshToken)
        }
      }
    }
    return JSON.stringify(data, null, 2)
  } catch (error) {
    logger.error(`Failed to encrypt auth JSON: ${error}`)
    return jsonString
  }
}

/**
 * Decrypt all credential values in an auth.json string.
 * Parses the JSON, decrypts encrypted fields, then re-serializes for use by the Pi SDK.
 */
function decryptAuthJson(jsonString: string): string {
  try {
    const data = JSON.parse(jsonString)
    let hasEncrypted = false
    for (const provider of Object.keys(data)) {
      const cred = data[provider]
      if (cred && cred.type === 'api_key' && typeof cred.key === 'string') {
        if (cred.key.startsWith(ENCRYPTED_PREFIX)) {
          try {
            cred.key = decryptValue(cred.key)
            hasEncrypted = true
          } catch {
            // If decryption fails, remove the credential — user must re-auth
            logger.warn(`Could not decrypt API key for provider ${provider} — removing`)
            delete data[provider]
          }
        }
      }
      if (cred && cred.type === 'oauth') {
        if (typeof cred.accessToken === 'string' && cred.accessToken.startsWith(ENCRYPTED_PREFIX)) {
          try {
            cred.accessToken = decryptValue(cred.accessToken)
            hasEncrypted = true
          } catch {
            logger.warn(`Could not decrypt OAuth access token for ${provider} — removing`)
            delete data[provider]
            continue
          }
        }
        if (typeof cred.refreshToken === 'string' && cred.refreshToken.startsWith(ENCRYPTED_PREFIX)) {
          try {
            cred.refreshToken = decryptValue(cred.refreshToken)
            hasEncrypted = true
          } catch {
            logger.warn(`Could not decrypt OAuth refresh token for ${provider} — removing`)
            delete data[provider]
          }
        }
      }
    }
    if (hasEncrypted) {
      logger.debug('Successfully decrypted credentials from auth storage')
    }
    return JSON.stringify(data, null, 2)
  } catch (error) {
    logger.error(`Failed to decrypt auth JSON: ${error}`)
    return jsonString
  }
}

/**
 * Create an encrypted wrapper around a FileAuthStorageBackend.
 *
 * This wraps the Pi SDK's auth storage so that API keys and OAuth tokens
 * are encrypted at rest using Electron's safeStorage API. The underlying
 * file still contains valid JSON, but sensitive fields are encrypted.
 *
 * Usage:
 * ```ts
 * const { AuthStorage, FileAuthStorageBackend } = await import('@earendil-works/pi-coding-agent')
 * const backend = new FileAuthStorageBackend()
 * const encryptedBackend = createEncryptedAuthStorage(backend)
 * const authStorage = AuthStorage.fromStorage(encryptedBackend)
 * ```
 */
export function createEncryptedAuthStorage(
  inner: AuthStorageBackend
): AuthStorageBackend {
  return {
    withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
      return inner.withLock((current) => {
        // Decrypt before passing to the SDK
        const decrypted = current ? decryptAuthJson(current) : current
        const lockResult = fn(decrypted)
        // Encrypt before writing back to disk
        if (lockResult.next) {
          lockResult.next = encryptAuthJson(lockResult.next)
        }
        return lockResult
      })
    },
    withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>): Promise<T> {
      return inner.withLockAsync(async (current) => {
        // Decrypt before passing to the SDK
        const decrypted = current ? decryptAuthJson(current) : current
        const lockResult = await fn(decrypted)
        // Encrypt before writing back to disk
        if (lockResult.next) {
          lockResult.next = encryptAuthJson(lockResult.next)
        }
        return lockResult
      })
    },
  }
}

/**
 * Create an AuthStorage instance with encrypted credential storage.
 * Falls back to plaintext storage if safeStorage is not available.
 *
 * Must be called after app.whenReady() in the main process.
 */
export async function createSecureAuthStorage() {
  const { AuthStorage, FileAuthStorageBackend } = await import('@earendil-works/pi-coding-agent')

  const fileBackend = new FileAuthStorageBackend()

  if (isSafeStorageAvailable()) {
    logger.info('safeStorage available — API keys will be encrypted at rest')
    const encryptedBackend = createEncryptedAuthStorage(fileBackend)
    return AuthStorage.fromStorage(encryptedBackend)
  } else {
    logger.warn('safeStorage not available — API keys stored in plaintext. This is expected in development/CI.')
    return AuthStorage.create()
  }
}
