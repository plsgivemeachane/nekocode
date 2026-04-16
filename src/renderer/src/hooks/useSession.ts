import { useState, useCallback, useRef, useEffect } from 'react'
import type { SessionStreamEvent, ChatMessageIPC, ModelInfo, UsageData } from '../../../shared/ipc-types'
import type { ChatMessage } from '../types/chat'
import { generateId } from '../types/chat'
import { createLogger } from '../logger'
import { useProjectStore } from '../stores/project-store'

const logger = createLogger('useSession')

/** Convert IPC message format to renderer ChatMessage format */
function ipcToChatMessage(ipc: ChatMessageIPC): ChatMessage[] {
  const msgs: ChatMessage[] = []
  if (ipc.content) {
    if (ipc.role === 'user') {
      msgs.push({ role: 'user', content: ipc.content, id: ipc.id })
    } else {
      msgs.push({ role: 'assistant', type: 'text', content: ipc.content, id: ipc.id })
    }
  }
  if (ipc.toolCalls) {
    for (const tc of ipc.toolCalls) {
      msgs.push({
        role: 'assistant',
        type: 'tool_call',
        toolName: tc.name,
        toolId: tc.id,
        args: tc.args,
        status: 'done',
        result: tc.result,
        isError: tc.isError,
        id: generateId(),
      })
    }
  }
  return msgs
}

/** Convert an array of IPC messages into renderer ChatMessages */
function ipcToChatMessages(ipcMessages: ChatMessageIPC[]): ChatMessage[] {
  return ipcMessages.flatMap(ipcToChatMessage)
}

interface UseSessionInput {
  sessionId: string | null
}

interface UseSessionOutput {
  messages: ChatMessage[]
  isHistoryLoading: boolean
  isStreaming: boolean
  error: string | null
  input: string
  setInput: (text: string) => void
  sendPrompt: (text: string) => Promise<void>
  abortPrompt: () => Promise<void>
  activeModel: ModelInfo | null
  modelList: ModelInfo[]
  setModel: (provider: string, modelId: string) => Promise<void>
  usage: UsageData
  streamStartTime: number
}

const INITIAL_MESSAGES: ChatMessage[] = []

/**
 * Pure session viewer driven by an external sessionId.
 * Subscribes to global events and filters by sessionId.
 * Manages its own message state and input draft per session.
 */
export function useSession({ sessionId }: UseSessionInput): UseSessionOutput {
  const { state: projectState } = useProjectStore()
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [activeModel, setActiveModel] = useState<ModelInfo | null>(null)
  const [modelList, setModelList] = useState<ModelInfo[]>([])
  const [usage, setUsage] = useState<UsageData>({ inputTokens: 0, outputTokens: 0, totalCost: 0, contextPercent: 0, contextWindow: 0 })

  // Derive isStreaming from the global store — single source of truth for ALL sessions
  const isStreaming = sessionId != null && projectState.sessionStatuses[sessionId] === 'streaming'

  // Per-session caches: survive session switches (same pattern as drafts)
  const streamStartTimes = useRef<Map<string, number>>(new Map())
  const usages = useRef<Map<string, UsageData>>(new Map())
  const errors = useRef<Map<string, string | null>>(new Map())
  const streamStartTime = sessionId != null
    ? (streamStartTimes.current.get(sessionId) ?? 0)
    : 0

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
    // Reset transient state
    const DEFAULT_USAGE = { inputTokens: 0, outputTokens: 0, totalCost: 0, contextPercent: 0, contextWindow: 0 }
    setError(sessionId !== null ? (errors.current.get(sessionId) ?? null) : null)
    setUsage(sessionId !== null ? (usages.current.get(sessionId) ?? DEFAULT_USAGE) : DEFAULT_USAGE)
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
      } else {
        // First time opening this session with no preload — full load
        setMessages(INITIAL_MESSAGES)
        setIsHistoryLoading(true)
        logger.debug(`loading history for ${sessionId.slice(0, 8)}...`)
        window.nekocode.session.loadHistory(sessionId).then((ipcMessages) => {
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

  // Fetch the active model for the current session
  useEffect(() => {
    if (!sessionId) {
      setActiveModel(null)
      return
    }
    let cancelled = false
    window.nekocode.session.getModel(sessionId).then((model) => {
      if (!cancelled) setActiveModel(model)
    }).catch(() => {
      if (!cancelled) setActiveModel(null)
    })
    return () => { cancelled = true }
  }, [sessionId])

  // Fetch available models list
  useEffect(() => {
    let cancelled = false
    window.nekocode.session.listModels().then((models) => {
      if (!cancelled) setModelList(models)
    }).catch(() => {
      if (!cancelled) setModelList([])
    })
    return () => { cancelled = true }
  }, [])

  // Subscribe to global session events, filter by our sessionId
  useEffect(() => {
    if (!sessionId) return
    logger.debug(`subscribing to events for ${sessionId.slice(0, 8)}...`)

    const unsub = window.nekocode.session.onEvent((payload) => {
      if (payload.sessionId !== sessionId) return

      const event: SessionStreamEvent = payload.event

      switch (event.type) {
        case 'agent_start':
          logger.info('agent_start received — streaming state from global store')
          setError(null)
          errors.current.set(sessionId, null)
          if (!streamStartTimes.current.has(sessionId) || streamStartTimes.current.get(sessionId) === 0) {
            streamStartTimes.current.set(sessionId, Date.now())
          }
          break

        case 'text_delta':
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant' && last.type === 'text') {
              msgs[msgs.length - 1] = { ...last, content: last.content + event.delta }
              if (msgs.length % 50 === 0) logger.debug(`text_delta: appended to last msg, total msgs=${msgs.length}`)
            } else {
              msgs.push({ role: 'assistant', type: 'text', content: event.delta, id: generateId() })
              logger.debug(`text_delta: created new assistant msg, total msgs=${msgs.length}`)
            }
            return msgs
          })
          break

        case 'tool_call':
          logger.debug(`tool_call event: name=${event.toolName}, id=${event.toolCallId}`)
          setMessages(prev => {
            const newMsg = {
              role: 'assistant' as const,
              type: 'tool_call' as const,
              toolName: event.toolName,
              toolId: event.toolCallId,
              args: event.args,
              status: 'running' as const,
              id: generateId(),
            }
            logger.debug(`adding tool_call message, prev length=${prev.length}, new length=${prev.length + 1}`)
            return [...prev, newMsg]
          })
          break

        case 'tool_result': {
          logger.debug(`tool_result event: name=${event.toolName}, id=${event.toolCallId}, isError=${event.isError}`)
          setMessages(prev => {
            const msgs = [...prev]
            let matched = false
            for (let i = msgs.length - 1; i >= 0; i--) {
              const msg = msgs[i]
              if (
                msg.role === 'assistant' &&
                msg.type === 'tool_call' &&
                msg.toolId === event.toolCallId &&
                msg.status === 'running'
              ) {
                msgs[i] = { ...msg, status: 'done', result: event.result, isError: event.isError }
                matched = true
                logger.debug(`matched tool_result to msg at index ${i}`)
                break
              }
            }
            if (!matched) {
              logger.warn(`tool_result NO MATCH: id=${event.toolCallId}, name=${event.toolName}. Running tool_calls:`, msgs.filter((m): m is Extract<ChatMessage, { type: 'tool_call' }> => m.role === 'assistant' && m.type === 'tool_call' && m.status === 'running').map(m => ({ id: m.toolId, name: m.toolName })))
            }
            return msgs
          })
          break
        }

        case 'error':
          logger.error(`session error: ${event.message}`)
          setError(event.message)
          errors.current.set(sessionId, event.message)
          break

        case 'done':
          logger.info('done event received — streaming complete')
          streamStartTimes.current.set(sessionId, 0)
          break

        case 'usage_update':
          setUsage(event.usage)
          usages.current.set(sessionId, event.usage)
          break
      }
    })

    return () => {
      logger.debug(`unsubscribing from events for ${sessionId.slice(0, 8)}...`)
      unsub()
    }
  }, [sessionId])

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

  const setModel = useCallback(
    async (provider: string, modelId: string): Promise<void> => {
      if (!sessionId) return
      try {
        const updated = await window.nekocode.session.setModel(sessionId, provider, modelId)
        setActiveModel(updated)
      } catch (err) {
        logger.error(`setModel failed: ${err}`)
        setError(`Failed to switch model: ${err}`)
      }
    },
    [sessionId],
  )

  return { messages, isHistoryLoading, isStreaming, error, input, setInput, sendPrompt, abortPrompt, activeModel, modelList, setModel, usage, streamStartTime }
}
