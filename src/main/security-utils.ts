/**
 * Security utilities for NekoCode main process.
 *
 * Provides IPC origin validation, path traversal prevention,
 * and other security helpers.
 */

import type { IpcMainInvokeEvent } from 'electron'
import { createLogger } from './logger'
import { resolve, relative } from 'path'

const logger = createLogger('security')

// ─── IPC Origin Validation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Allowed origins for IPC calls from the renderer.
 * In development, the electron-vite dev server URL is allowed.
 * In production, only the file:// protocol from the app's own renderer is allowed.
 */
const ALLOWED_DEV_ORIGINS = [
  'http://localhost:5173',  // electron-vite default dev server
  'http://localhost:5174',  // alternate port
  'http://localhost:5175',  // alternate port
]

/**
 * Validate that an IPC event originates from the expected renderer.
 * Prevents compromised renderers or webviews from invoking privileged IPC handlers.
 *
 * @param event - The IpcMainInvokeEvent from the IPC handler
 * @throws Error if the sender is not authorized
 */
export function validateIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url

  if (!senderUrl) {
    // In sandbox mode, senderFrame may be undefined for same-process calls.
    // This is acceptable for internal IPC.
    return
  }

  // Production: renderer loads from file:// protocol
  if (senderUrl.startsWith('file://')) {
    return
  }

  // Development: renderer loads from electron-vite dev server
  if (ALLOWED_DEV_ORIGINS.some(origin => senderUrl.startsWith(origin))) {
    return
  }

  // Block any other origin
  logger.warn(`IPC call from unauthorized origin blocked: ${senderUrl}`)
  throw new Error(`Unauthorized IPC call from origin: ${senderUrl}`)
}

// ─── Path Traversal Prevention ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validate that a file path stays within the project root directory.
 * Prevents directory traversal attacks (e.g., "../../etc/passwd").
 *
 * @param filePath - The file path to validate
 * @param projectRoot - The project root directory that the path must stay within
 * @throws Error if the path escapes the project root
 */
export function validatePathWithinProject(filePath: string, projectRoot: string): void {
  const resolvedPath = resolve(projectRoot, filePath)
  const relativePath = relative(projectRoot, resolvedPath)

  // If the relative path starts with "..", it escapes the project root
  if (relativePath.startsWith('..') || resolve(projectRoot, filePath) !== resolvedPath) {
    logger.warn(`Path traversal blocked: ${filePath} escapes project root ${projectRoot}`)
    throw new Error(`Path traversal detected: ${filePath} is outside the project directory`)
  }
}

// ─── Shell Metacharacter Sanitization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Strip shell metacharacters from a string to prevent command injection.
 * While simple-git handles quoting internally, this is a defense-in-depth measure
 * in case simple-git ever falls back to shell execution.
 *
 * @param input - The string to sanitize
 * @returns The sanitized string with shell metacharacters removed
 */
export function stripShellMetacharacters(input: string): string {
  // Remove characters that could be interpreted by shells:
  // backticks (`), dollar-sign substitutions ($(...)), and backslash escapes
  return input
    .replace(/`/g, '')
    .replace(/\$\(/g, '')
    .replace(/\\/g, '')
}
