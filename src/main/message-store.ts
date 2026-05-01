import { SessionManager as SdkSessionManager } from '@mariozechner/pi-coding-agent'
import type { AgentSession, SessionMessageEntry } from '@mariozechner/pi-coding-agent'
import type { ToolCall, Message } from '@mariozechner/pi-ai'
import type { ChatMessageIPC } from '../shared/ipc-types'
import { extractTextContent } from './text-extractor'
import { createLogger } from './logger'

const logger = createLogger('message-store')

/**
 * Extract ChatMessageIPC[] from the SDK's AgentMessage[].
 * Converts the SDK's internal message format to the lightweight IPC format.
 * Only handles UserMessage and AssistantMessage - skips BashExecutionMessage,
 * ToolResultMessage, and other custom message types.
 */
export function extractHistoryFromSdkMessages(
  sdkMessages: AgentSession['messages'],
): ChatMessageIPC[] {
  logger.debug(`extractHistoryFromSdkMessages: ${sdkMessages.length} raw SDK message(s)`)
  const result: ChatMessageIPC[] = []

  // First pass: collect toolResult messages keyed by toolCallId
  const toolResults = new Map<string, { result: unknown; isError: boolean }>()
  for (const msg of sdkMessages) {
    if (!('role' in msg)) continue
    const m = msg as Message
    if (m.role === 'toolResult') {
      const content = extractTextContent(m.content)
      toolResults.set(m.toolCallId, { result: content, isError: !!m.isError })
    }
  }

  for (const msg of sdkMessages) {
    if (!('role' in msg)) continue
    const m = msg as Message
    const role = m.role
    if (role !== 'user' && role !== 'assistant') continue

    const content = extractTextContent(m.content)

    // Extract tool calls from assistant messages
    let toolCalls: ChatMessageIPC['toolCalls']
    if (role === 'assistant' && Array.isArray(m.content)) {
      const tcBlocks = m.content.filter((block): block is ToolCall => block.type === 'toolCall')
      if (tcBlocks.length > 0) {
        toolCalls = tcBlocks.map(tc => {
          const tcResult = toolResults.get(tc.id)
          return {
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            result: tcResult?.result,
            isError: tcResult?.isError,
          }
        })
      }
    }

    // Extract usage from assistant messages if available
    let usage: ChatMessageIPC['usage']
    if (role === 'assistant' && 'usage' in m && m.usage) {
      const sdkUsage = m.usage as { input: number; output: number; cost: { total: number } }
      usage = {
        inputTokens: sdkUsage.input,
        outputTokens: sdkUsage.output,
        totalCost: sdkUsage.cost.total,
      }
    }

    result.push({
      id: crypto.randomUUID(),
      role,
      content,
      toolCalls,
      timestamp: 'timestamp' in m ? m.timestamp : Date.now(),
      usage,
    })
  }

  logger.debug(`extractHistoryFromSdkMessages: produced ${result.length} ChatMessageIPC(s)`)
  return result
}

/**
 * Load message history from disk WITHOUT creating an agent session.
 * Lightweight alternative to reconnect() - just reads the session file and extracts messages.
 * Used for preloading session timelines in the sidebar.
 * @param limit Max number of recent messages to return (0 = all)
 */
export async function loadHistoryFromDisk(
  sessionId: string,
  cwd: string,
  limit: number = 0,
): Promise<ChatMessageIPC[]> {
  logger.info(`loadHistoryFromDisk ${sessionId} cwd=${cwd} limit=${limit}`)
  const infos = await SdkSessionManager.list(cwd)
  const match = infos.find(info => info.id === sessionId)
  if (!match?.path) {
    logger.debug(`loadHistoryFromDisk ${sessionId} - not found on disk, returning empty`)
    return []
  }

  const sdkSessionMgr = SdkSessionManager.open(match.path)
  const allMessages = extractHistoryFromSdkMessages(
    sdkSessionMgr.getEntries()
      .filter((e): e is SessionMessageEntry => e.type === 'message')
      .map(e => e.message),
  )
  const diskMessages = limit > 0 && allMessages.length > limit
    ? allMessages.slice(-limit)
    : allMessages
  logger.debug(`loadHistoryFromDisk ${sessionId} - ${diskMessages.length}/${allMessages.length} message(s) returned`)
  return diskMessages
}

/**
 * Attempt to refresh an in-memory message list from disk.
 * Only updates if disk has more messages than memory, and never overwrites
 * while the session is actively streaming (indicated by currentAssistantId).
 */
export async function tryRefreshFromDisk(
  sessionId: string,
  cwd: string,
  currentMessages: ChatMessageIPC[],
  currentAssistantId: string | null,
): Promise<ChatMessageIPC[] | null> {
  try {
    if (currentAssistantId) return null

    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (!match?.path) return null

    const sdkSessionMgr = SdkSessionManager.open(match.path)
    const diskMessages = extractHistoryFromSdkMessages(
      sdkSessionMgr.getEntries()
        .filter((e): e is SessionMessageEntry => e.type === 'message')
        .map(e => e.message),
    )

    if (diskMessages.length > currentMessages.length) {
      logger.info(`Background refresh ${sessionId} - updated ${currentMessages.length} -> ${diskMessages.length} messages`)
      return diskMessages
    }
    return null
  } catch (err) {
    logger.debug(`Background refresh failed for ${sessionId}: ${err}`)
    return null
  }
}
