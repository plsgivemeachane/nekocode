/**
 * Threading Infrastructure for Nekocode
 * 
 * This module provides worker thread offloading for heavy I/O operations
 * to prevent main thread blocking and UI lag.
 * 
 * Architecture Decision:
 * - Worker threads handle pure I/O operations (file reads/writes, directory scanning)
 * - Session SDK operations remain on main thread due to streaming event requirements
 * - This hybrid approach balances performance with complexity
 */

export { ThreadOperationQueue } from './thread-operation-queue'
export * from './types'
