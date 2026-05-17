import { useState, useCallback, useRef, useEffect } from 'react'
import type { UsageData } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'
import { createLogger } from '../utils/logger'
import { useProjectStore } from '../stores/project-store'
import { useModelSelection } from './useModelSelection'
import { useSessionEvents } from './useSessionEvents'
import { ipcToChatMessages, messageSignature, isSessionNotReadyError } from '../utils/message-transforms'
import { isPendingSession } from '../utils/project-helpers'

const logger = createLogger('useSession')

const INITIAL_MESSAGES: ChatMessage[] = []
const DEFAULT_USAGE: UsageData = { inputTokens: 0, outputTokens: 0, totalCost: 0, contextPercent: 0, contextWindow: 0 }

interface UseSessionInput {
  sessionId: string | null
}

interface UseSessionOutput {
  messages: ChatMessage[]
  isHistoryLoading: boolean
  /** True during the ~1 frame window after sessionId changes but before messages are updated for the new session. */
  isMessagesStale: boolean
  isStreaming: boolean
  error: string | null
  clearError: () => void
  input: string
  setInput: (v: string) => void
  sendPrompt: (text: string) => Promise<void>
  abortPrompt: () => Promise<void>
  activeModel: ReturnType<typeof useModelSelection>['activeModel']
  modelList: ReturnType<typeof useModelSelection>['modelList']
  setModel: ReturnType<typeof useModelSelection>['setModel']
  usage: UsageData
  streamStartTime: number
}

export function useSession({ sessionId }: UseSessionInput): UseSessionOutput {
  const { state: projectState } = useProjectStore()
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [usage, setUsage] = useState<UsageData>(DEFAULT_USAGE)

  // Derive isStreaming from the global store — single source of truth for ALL sessions
  const isStreaming = sessionId != null && projectState.sessionStatuses[sessionId] === 'streaming'

  // Watch the refresh key for the current session to force-reload messages
  const refreshKey = sessionId != null ? projectState.sessionRefreshKeys[sessionId] : undefined

  // Delegate model management
  const { activeModel, modelList, setModel } = useModelSelection(sessionId)

  // Delegate event handling to useSessionEvents
  const { getStreamStartTime, getCachedError, getCachedUsage } = useSessionEvents({
    sessionId,
    onMessages: setMessages,
    onError: setError,
    onUsage: setUsage,
  })

  const streamStartTime = sessionId != null ? getStreamStartTime(sessionId) : 0

  // Draft preservation: save input text when switching away, restore when switching back
  const drafts = useRef<Map<string, string>>(new Map())
  const messagesBySession = useRef<Map<string, ChatMessage[]>>(new Map())

  // Track which refreshKey was active when each session's cache was last updated.
  // If the current refreshKey doesn't match, the cache is stale and should be invalidated.
  const cacheRefreshKeys = useRef<Map<string, number>>(new Map())

  // Tracks which sessionId the current `messages` state was last loaded for.
  // When sessionId changes but this ref still points to the old session, messages are stale.
  // This catches the ~1 frame window between sessionId update and messages update.
  const messagesLoadedForRef = useRef<string | null>(null)

  // Keep a snapshot of each session's latest rendered messages for instant restore on switch.
  // Guard: only write to cache when messages have been loaded for the CURRENT session.
  // Without this guard, a sessionId change triggers this effect before the session-switch
  // effect updates messages, causing the OLD session's messages to be written under the
  // NEW session's key — corrupting the cache and showing stale data on switch-back.
  useEffect(() => {
    if (!sessionId) return
    if (messagesLoadedForRef.current !== sessionId) return
    messagesBySession.current.set(sessionId, messages)
    // Record the refresh key that was active when this cache entry was written
    const currentRefreshKey = projectState.sessionRefreshKeys[sessionId]
    if (currentRefreshKey !== undefined) {
      cacheRefreshKeys.current.set(sessionId, currentRefreshKey)
    }
  }, [sessionId, messages])

  // Track whether current session used preloaded (truncated) data
  const usedPreloadedRef = useRef(false)

  // Handle draft save/restore + preload check on sessionId change.
  // This is the SINGLE effect that sets messages on session switch — no flash.
  const prevSessionRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const prev = prevSessionRef.current
    // Save draft for previous session
    if (prev !== null) {
      drafts.current.set(prev, input)
      logger.debug(`draft saved for ${prev.slice(0, 8)}...`)
    }
    usedPreloadedRef.current = false
    // Reset transient state (read from useSessionEvents caches)
    setError(sessionId !== null ? getCachedError(sessionId) : null)
    setUsage(sessionId !== null ? getCachedUsage(sessionId) : DEFAULT_USAGE)
    // Restore draft for new session
    const draft = sessionId !== null ? drafts.current.get(sessionId) : null
    if (draft) {
      logger.debug(`draft restored for ${sessionId!.slice(0, 8)}...`)
    }
    // Preserve current input when switching to a non-null session with no saved draft.
    // When sessionId is null, clear the input (no active session = no input).
    // When sessionId is non-null but has no draft (e.g. new session), keep current text.
    setInput(sessionId !== null ? (draft ?? input) : "")
    if (!sessionId) {
      setMessages(INITIAL_MESSAGES)
      setIsHistoryLoading(false)
      messagesLoadedForRef.current = null
      prevSessionRef.current = sessionId
      return () => { cancelled = true }
    }
    // Skip history loading for pending sessions (optimistic UI updates)
    if (isPendingSession(sessionId)) {
      logger.debug(`pending session ${sessionId.slice(0, 8)}... — skipping history load`)
      setMessages(INITIAL_MESSAGES)
      setIsHistoryLoading(false)
      messagesLoadedForRef.current = sessionId
      prevSessionRef.current = sessionId
      return () => { cancelled = true }
    }
    // Priority 1: Check renderer-side message cache (most up-to-date — updated in real-time during streaming).
    // This must be checked BEFORE preloadedHistory because preloadedHistory is a snapshot from startup/hover
    // that becomes stale as the user interacts with the session. Using stale preloaded data would overwrite
    // the good cache and cause "lost messages" when switching back to a session.
    // However, if the user has triggered a refresh for this session (refreshKey mismatch), invalidate the cache.
    const currentRefreshKey = projectState.sessionRefreshKeys[sessionId]
    const cachedRefreshKey = cacheRefreshKeys.current.get(sessionId)
    const cacheIsStaleDueToRefresh = currentRefreshKey !== undefined && cachedRefreshKey !== currentRefreshKey
    const cachedMessages = !cacheIsStaleDueToRefresh ? messagesBySession.current.get(sessionId) : undefined
    if (cacheIsStaleDueToRefresh) {
      // Clear stale cache — the user explicitly requested a refresh for this session
      messagesBySession.current.delete(sessionId)
      cacheRefreshKeys.current.delete(sessionId)
      logger.debug(`cache invalidated due to refresh for ${sessionId.slice(0, 8)}... (key ${cachedRefreshKey} -> ${currentRefreshKey})`)
    }
    if (cachedMessages) {
      setMessages(cachedMessages)
      setIsHistoryLoading(false)
      messagesLoadedForRef.current = sessionId

      // Reconcile cached view with canonical session history to prevent stale
      // messages from previous reconnect/cache state.
      window.nekocode.session.loadHistory(sessionId).catch((err) => {
        if (isSessionNotReadyError(err) && projectState.activeProjectPath) {
          logger.debug(`reconcile fallback to disk for ${sessionId.slice(0, 8)}...`)
          return window.nekocode.session.loadHistoryFromDisk(sessionId, projectState.activeProjectPath, 0)
        }
        throw err
      }).then((ipcMessages) => {
        if (cancelled) return
        const canonicalMessages = ipcToChatMessages(ipcMessages)
        const canonicalSig = messageSignature(canonicalMessages)
        setMessages((prev) => {
          const prevSig = messageSignature(prev)
          if (prevSig === canonicalSig) return prev
          // Don't replace if renderer has MORE messages than IPC — the renderer
          // cache may include real-time streaming updates not yet reflected in IPC.
          if (prev.length > canonicalMessages.length) {
            logger.debug(`reconciliation skipped: renderer has ${prev.length} msgs vs ${canonicalMessages.length} canonical for ${sessionId.slice(0, 8)}...`)
            return prev
          }
          logger.info(`history reconciled: ${prev.length} -> ${canonicalMessages.length} messages for ${sessionId.slice(0, 8)}...`)
          return canonicalMessages
        })
        // Cache is managed exclusively by the cache effect above — do not overwrite here.
        // Unconditional overwrite was losing streaming-updated messages when IPC returned
        // stale (fewer) messages. The cache effect fires after setMessages changes and
        // keeps the cache in sync automatically.
      }).catch((err) => {
        if (!cancelled) logger.warn('Failed to reconcile cached history', err)
      })
    } else {
      // Priority 2: Check preloaded history (from startup initReconnect or sidebar hover preload).
      // Only used when there's no renderer cache — e.g. first time opening a session in this window.
      const preloaded = projectState.preloadedHistory[sessionId]
      if (preloaded && preloaded.length > 0) {
        logger.info(`using preloaded history: ${preloaded.length} messages for ${sessionId.slice(0, 8)}...`)
        const chatMessages = ipcToChatMessages(preloaded)
        setMessages(chatMessages)
        messagesBySession.current.set(sessionId, chatMessages)
        usedPreloadedRef.current = true
        setIsHistoryLoading(false)
        messagesLoadedForRef.current = sessionId
      } else {
        // Priority 3: First time opening this session with no preload — full load
        setMessages(INITIAL_MESSAGES)
        setIsHistoryLoading(true)
        messagesLoadedForRef.current = sessionId
        logger.debug(`loading history for ${sessionId.slice(0, 8)}...`)

        // When the agent is not yet connected (e.g. startup auto-resume),
        // the in-memory loadHistory will throw. Fall back to disk read.
        const doLoad = (projectState.agentReady
          ? window.nekocode.session.loadHistory(sessionId)
          : projectState.activeProjectPath
            ? window.nekocode.session.loadHistoryFromDisk(sessionId, projectState.activeProjectPath, 0)
            : Promise.reject(new Error('no project path available')))
          .catch((err) => {
            if (isSessionNotReadyError(err) && projectState.activeProjectPath) {
              logger.debug(`history fallback to disk for ${sessionId.slice(0, 8)}...`)
              return window.nekocode.session.loadHistoryFromDisk(sessionId, projectState.activeProjectPath, 0)
            }
            throw err
          })

        doLoad.then((ipcMessages) => {
          if (cancelled) return
          logger.info(`history loaded: ${ipcMessages.length} messages for ${sessionId.slice(0, 8)}...`)
          const chatMessages = ipcToChatMessages(ipcMessages)
          setMessages(chatMessages)
          messagesBySession.current.set(sessionId, chatMessages)
        }).catch((err) => {
          if (!cancelled) logger.warn('Failed to load history', err)
        }).finally(() => {
          if (!cancelled) setIsHistoryLoading(false)
        })
      }
    }
    prevSessionRef.current = sessionId
    return () => { cancelled = true }
  }, [sessionId]) // Intentionally NOT depending on projectState.preloadedHistory

  // When agent becomes ready, silently fill in older messages from full history.
  // Only runs if we used preloaded (truncated) data — prepends without replacing.
  useEffect(() => {
    if (!sessionId || !projectState.agentReady) return
    if (!usedPreloadedRef.current) return
    let cancelled = false
    logger.debug(`agent ready — loading full history for ${sessionId.slice(0, 8)}...`)
    window.nekocode.session.loadHistory(sessionId).then((ipcMessages) => {
      if (cancelled) return
      const fullChatMessages = ipcToChatMessages(ipcMessages)
      const currentMessages = messagesBySession.current.get(sessionId)
      if (currentMessages && fullChatMessages.length > currentMessages.length) {
        const olderCount = fullChatMessages.length - currentMessages.length
        const mergedMessages = [...fullChatMessages.slice(0, olderCount), ...currentMessages]
        logger.info(`full history: prepended ${olderCount} older messages for ${sessionId.slice(0, 8)}...`)
        setMessages(mergedMessages)
        messagesBySession.current.set(sessionId, mergedMessages)
      } else {
        logger.debug(`full history: no additional messages for ${sessionId.slice(0, 8)}...`)
      }
      usedPreloadedRef.current = false
    }).catch((err) => {
      if (!cancelled) logger.warn('Failed to load full history after agent ready', err)
    })
    return () => { cancelled = true }
  }, [sessionId, projectState.agentReady])

  // Force-reload messages when the user requests a refresh via context menu.
  // Clears the renderer cache and preloaded data, then reloads from the backend.
  useEffect(() => {
    if (!sessionId || refreshKey === undefined) return
    let cancelled = false
    logger.info(`refresh triggered for ${sessionId.slice(0, 8)}... (key=${refreshKey})`)
    // Clear the renderer-side message cache so the reload is truly fresh
    messagesBySession.current.delete(sessionId)
    usedPreloadedRef.current = false
    setIsHistoryLoading(true)
    setMessages(INITIAL_MESSAGES)
    messagesLoadedForRef.current = sessionId

    // Reload from the backend (try in-memory first, fall back to disk)
    window.nekocode.session.loadHistory(sessionId)
      .catch((err) => {
        if (isSessionNotReadyError(err) && projectState.activeProjectPath) {
          logger.debug(`refresh fallback to disk for ${sessionId.slice(0, 8)}...`)
          return window.nekocode.session.loadHistoryFromDisk(sessionId, projectState.activeProjectPath, 0)
        }
        throw err
      })
      .then((ipcMessages) => {
        if (cancelled) return
        logger.info(`refresh loaded: ${ipcMessages.length} messages for ${sessionId.slice(0, 8)}...`)
        const chatMessages = ipcToChatMessages(ipcMessages)
        setMessages(chatMessages)
        messagesBySession.current.set(sessionId, chatMessages)
        // Mark the cache as up-to-date with the current refresh key
        if (refreshKey !== undefined) {
          cacheRefreshKeys.current.set(sessionId, refreshKey)
        }
      })
      .catch((err) => {
        if (!cancelled) logger.warn('Failed to refresh session messages', err)
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false)
      })

    return () => { cancelled = true }
  }, [sessionId, refreshKey])

  const sendPrompt = useCallback(
    async (text: string): Promise<void> => {
      if (!sessionId) return
      const userMsg: ChatMessage = { role: 'user', content: text, id: generateId() }
      setMessages(prev => [...prev, userMsg])
      setError(null)
      logger.info(`sendPrompt: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)
      try {
        await window.nekocode.session.prompt(sessionId, text)
      } catch (err) {
        logger.error(`sendPrompt failed: ${err}`)
        setError(`Prompt failed: ${err}`)
      }
    },
    [sessionId],
  )

  const abortPrompt = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      await window.nekocode.session.abort(sessionId)
    } catch (err) {
      logger.error(`abortPrompt failed: ${err}`)
      setError(`Failed to stop response: ${err}`)
    }
  }, [sessionId])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Compute staleness: messages are stale when sessionId has changed but messages
  // haven't been updated yet (the ~1 frame window between store update and effect).
  const isMessagesStale = sessionId != null && messagesLoadedForRef.current !== sessionId

  return { messages, isHistoryLoading, isMessagesStale, isStreaming, error, clearError, input, setInput, sendPrompt, abortPrompt, activeModel, modelList, setModel, usage, streamStartTime }
}
