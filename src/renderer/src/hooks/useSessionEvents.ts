import { useEffect, useRef } from 'react'
import type { SessionStreamEvent, UsageData } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { createLogger } from '../logger'
import { handleTextDelta, handleToolCall, handleToolResult } from '../utils/message-transforms'

const logger = createLogger('useSessionEvents')

const DEFAULT_USAGE: UsageData = { inputTokens: 0, outputTokens: 0, totalCost: 0, contextPercent: 0, contextWindow: 0 }

export interface UseSessionEventsOptions {
  sessionId: string | null
  onMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  onError: (error: string | null) => void
  onUsage: (usage: UsageData) => void
}

export interface UseSessionEventsReturn {
  /** Get the stream start time for a given session */
  getStreamStartTime: (sessionId: string) => number
  /** Get the cached error for a given session */
  getCachedError: (sessionId: string) => string | null
  /** Get the cached usage for a given session */
  getCachedUsage: (sessionId: string) => UsageData
}

/**
 * Subscribe to global session events, filtered by sessionId.
 * Handles: text_delta, tool_call, tool_result, agent_start, done, error, usage_update.
 */
export function useSessionEvents({
  sessionId,
  onMessages,
  onError,
  onUsage,
}: UseSessionEventsOptions): UseSessionEventsReturn {
  // Per-session caches for streaming state that survive across renders
  const streamStartTimes = useRef<Map<string, number>>(new Map())
  const usages = useRef<Map<string, UsageData>>(new Map())
  const errors = useRef<Map<string, string | null>>(new Map())

  useEffect(() => {
    if (!sessionId) return
    logger.debug(`subscribing to events for ${sessionId.slice(0, 8)}...`)

    const unsub = window.nekocode.session.onEvent((payload) => {
      if (payload.sessionId !== sessionId) return

      const event: SessionStreamEvent = payload.event

      switch (event.type) {
        case 'agent_start':
          logger.info('agent_start received — streaming state from global store')
          onError(null)
          errors.current.set(sessionId, null)
          if (!streamStartTimes.current.has(sessionId) || streamStartTimes.current.get(sessionId) === 0) {
            streamStartTimes.current.set(sessionId, Date.now())
          }
          break

        case 'text_delta':
          onMessages(prev => handleTextDelta(prev, event.delta))
          break

        case 'tool_call':
          logger.debug(`tool_call event: name=${event.toolName}, id=${event.toolCallId}`)
          onMessages(prev => handleToolCall(prev, event))
          break

        case 'tool_result': {
          logger.debug(`tool_result event: name=${event.toolName}, id=${event.toolCallId}, isError=${event.isError}`)
          onMessages(prev => {
            const result = handleToolResult(prev, event)
            if (result === prev) {
              logger.warn(`tool_result NO MATCH: id=${event.toolCallId}, name=${event.toolName}. Running tool_calls:`, prev.filter((m): m is Extract<ChatMessage, { type: 'tool_call' }> => m.role === 'assistant' && m.type === 'tool_call' && m.status === 'running').map(m => ({ id: m.toolId, name: m.toolName })))
            }
            return result
          })
          break
        }

        case 'error':
          logger.error(`session error: ${event.message}`)
          onError(event.message)
          errors.current.set(sessionId, event.message)
          break

        case 'done':
          logger.info('done event received — streaming complete')
          streamStartTimes.current.set(sessionId, 0)
          break

        case 'usage_update':
          onUsage(event.usage)
          usages.current.set(sessionId, event.usage)
          break
      }
    })

    return () => {
      logger.debug(`unsubscribing from events for ${sessionId.slice(0, 8)}...`)
      unsub()
    }
  }, [sessionId, onMessages, onError, onUsage])

  return {
    getStreamStartTime: (sid: string) => streamStartTimes.current.get(sid) ?? 0,
    getCachedError: (sid: string) => errors.current.get(sid) ?? null,
    getCachedUsage: (sid: string) => usages.current.get(sid) ?? DEFAULT_USAGE,
  }
}
