import { useState, useCallback, useRef, useEffect } from 'react'
import type { UsageData } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'
import { createLogger } from '../utils/logger'
import { useProjectStore } from '../stores/project-store'
import { useModelSelection } from './useModelSelection'
import { useSessionEvents } from './useSessionEvents'
import { ipcToChatMessages, messageSignature, isSessionNotReadyError } from '../utils/message-transforms'

const logger = createLogger('useSession')

const INITIAL_MESSAGES: ChatMessage[] = []
const DEFAULT_USAGE: UsageData = { inputTokens: 0, outputTokens: 0, totalCost: 0, contextPercent: 0, contextWindow: 0 }

interface UseSessionInput {
  sessionId: string | null
}

interface UseSessionOutput {
  messages: ChatMessage[]
  isHistoryLoading: boolean
  isStreaming: boolean
  error: string | null
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

  // Keep a snapshot of each session's latest rendered messages for instant restore on switch.
  useEffect(() => {
    if (!sessionId) return
    messagesBySession.current.set(sessionId, messages)
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
    setInput(draft ?? '')
    if (!sessionId) {
      setMessages(INITIAL_MESSAGES)
      setIsHistoryLoading(false)
      prevSessionRef.current = sessionId
      return () => { cancelled = true }
    }
    // Check for preloaded history FIRST (instant, no flash)
    const preloaded = projectState.preloadedHistory[sessionId]
    if (preloaded && preloaded.length > 0) {
      logger.info(`using preloaded history: ${preloaded.length} messages for ${sessionId.slice(0, 8)}...`)
      const chatMessages = ipcToChatMessages(preloaded)
      setMessages(chatMessages)
      messagesBySession.current.set(sessionId, chatMessages)
      usedPreloadedRef.current = true
      setIsHistoryLoading(false)
    } else {
      // No preloaded data — restore from cache or trigger full load
      const cachedMessages = messagesBySession.current.get(sessionId)
      if (cachedMessages) {
        setMessages(cachedMessages)
        setIsHistoryLoading(false)

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
            logger.info(`history reconciled: ${prev.length} -> ${canonicalMessages.length} messages for ${sessionId.slice(0, 8)}...`)
            return canonicalMessages
          })
          messagesBySession.current.set(sessionId, canonicalMessages)
        }).catch((err) => {
          if (!cancelled) logger.warn('Failed to reconcile cached history', err)
        })
      } else {
        // First time opening this session with no preload — full load
        setMessages(INITIAL_MESSAGES)
        setIsHistoryLoading(true)
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

  return { messages, isHistoryLoading, isStreaming, error, input, setInput, sendPrompt, abortPrompt, activeModel, modelList, setModel, usage, streamStartTime }
}
