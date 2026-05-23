/**
 * useComs — React hook for the coms (inter-agent messaging) system.
 *
 * Provides reactive access to the peer pool, inbound message handling,
 * and outbound send/get/await operations.
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  ComsPeer,
  ComsSendPayload,
  ComsSendResult,
  ComsGetPayload,
  ComsGetResult,
  ComsAwaitPayload,
  ComsAwaitResult,
  ComsInboundEvent,
} from '../../../shared/ipc-types'
import { createLogger } from '../utils/logger'

const logger = createLogger('useComs')

/** Refresh interval for polling the peer pool (ms) */
const PEER_REFRESH_INTERVAL = 15_000

export interface UseComsOutput {
  /** Current list of known peer agents */
  peers: ComsPeer[]
  /** Whether the peer list is currently loading */
  loading: boolean
  /** Last error from a coms operation */
  error: string | null
  /** Inbound messages received since the hook mounted */
  inboundMessages: ComsInboundEvent[]
  /** Manually refresh the peer list */
  refresh: () => Promise<void>
  /** Send a prompt to a peer agent */
  send: (payload: ComsSendPayload) => Promise<ComsSendResult>
  /** Non-blocking poll of a pending reply */
  get: (payload: ComsGetPayload) => Promise<ComsGetResult>
  /** Block until a pending reply lands or timeout */
  awaitReply: (payload: ComsAwaitPayload) => Promise<ComsAwaitResult>
  /** Dismiss an inbound message */
  dismissInbound: (msgId: string) => void
}

export function useComs(enabled?: boolean): UseComsOutput {
  const [peers, setPeers] = useState<ComsPeer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inboundMessages, setInboundMessages] = useState<ComsInboundEvent[]>([])
  const isActive = enabled !== false

  // ━━ Peer list refresh ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const refresh = useCallback(async () => {
    if (!isActive) return
    // Guard: coms API may not be available in all environments (e.g., tests)
    if (!window.nekocode?.coms?.list) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.nekocode.coms.list({})
      setPeers(result.agents)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to refresh peer list: ${msg}`)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [isActive])

  // Initial load + periodic refresh
  useEffect(() => {
    if (!isActive) return

    refresh()

    const timer = setInterval(() => {
      refresh()
    }, PEER_REFRESH_INTERVAL)

    return () => clearInterval(timer)
  }, [isActive, refresh])

  // ━━ Inbound message listener ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  useEffect(() => {
    if (!isActive) return
    // Guard: coms API may not be available in all environments
    if (!window.nekocode?.coms?.onInbound) return

    const unsubscribe = window.nekocode.coms.onInbound((event: ComsInboundEvent) => {
      logger.info(`Inbound message from ${event.senderName}: ${event.prompt.slice(0, 80)}`)
      setInboundMessages((prev) => [...prev, event])
    })

    return unsubscribe
  }, [isActive])

  // ━━ Outbound operations ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const send = useCallback(async (payload: ComsSendPayload): Promise<ComsSendResult> => {
    if (!window.nekocode?.coms?.send) throw new Error('coms API not available')
    try {
      setError(null)
      const result = await window.nekocode.coms.send(payload)
      logger.info(`Sent message to ${payload.target}, msgId=${result.msgId}`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`coms.send failed: ${msg}`)
      setError(msg)
      throw err
    }
  }, [])

  const get = useCallback(async (payload: ComsGetPayload): Promise<ComsGetResult> => {
    if (!window.nekocode?.coms?.get) return { status: 'error', error: 'coms API not available' }
    try {
      return await window.nekocode.coms.get(payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`coms.get failed: ${msg}`)
      setError(msg)
      return { status: 'error', error: msg }
    }
  }, [])

  const awaitReply = useCallback(async (payload: ComsAwaitPayload): Promise<ComsAwaitResult> => {
    if (!window.nekocode?.coms?.await) return { error: 'coms API not available' }
    try {
      setError(null)
      return await window.nekocode.coms.await(payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`coms.await failed: ${msg}`)
      setError(msg)
      return { error: msg }
    }
  }, [])

  const dismissInbound = useCallback((msgId: string) => {
    setInboundMessages((prev) => prev.filter((m) => m.msgId !== msgId))
  }, [])

  return {
    peers,
    loading,
    error,
    inboundMessages,
    refresh,
    send,
    get,
    awaitReply,
    dismissInbound,
  }
}
