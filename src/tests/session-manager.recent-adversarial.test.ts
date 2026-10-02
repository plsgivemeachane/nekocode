import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { SessionStreamEvent } from '@/shared/ipc-types'

const sdk = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test-logs') } }))
vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: sdk.create,
  DefaultResourceLoader: class { reload = vi.fn(async () => {}) },
  getAgentDir: vi.fn(() => '/tmp/agent'),
  SettingsManager: { create: vi.fn(() => ({})) },
  SessionManager: { inMemory: vi.fn(() => ({})), create: vi.fn(async () => ({ sessionFile: 'retry-session' })) },
}))

import { PiSessionManager } from '@/main/session-manager'

function assistant(): AssistantMessage {
  return {
    role: 'assistant', content: [], api: 'openai-responses', provider: 'openai', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  }
}

describe('PiSessionManager retry settlement compatibility', () => {
  let emit: ReturnType<typeof vi.fn<(sessionId: string, event: SessionStreamEvent) => void>>
  let session: { emit: (event: AgentSessionEvent) => void }
  let manager: PiSessionManager | undefined

  beforeEach(() => {
    manager = undefined
    emit = vi.fn<(sessionId: string, event: SessionStreamEvent) => void>()
    const listeners: Array<(event: AgentSessionEvent) => void> = []
    session = {
      emit(event) { for (const listener of listeners) listener(event) },
    }
    sdk.create.mockResolvedValue({
      session: {
        sessionId: 'retry-session', messages: [], model: { id: 'm', name: 'M', provider: 'p' },
        subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => { listeners.push(listener); return vi.fn() }),
        prompt: vi.fn(async () => {}), setModel: vi.fn(async () => {}), abort: vi.fn(), dispose: vi.fn(),
        getActiveToolNames: vi.fn(() => []), setActiveToolsByName: vi.fn(), getContextUsage: vi.fn(() => ({ percent: 0, contextWindow: 1 })),
        modelRuntime: { getAvailable: vi.fn(async () => []), getModel: vi.fn() },
      },
      extensionsResult: { extensions: [], loadedExtensionIds: [], errors: [] },
    })
  })

  afterEach(() => manager?.disposeAll())

  it('holds done until agent_settled when agent_end announces a retry', async () => {
    manager = new PiSessionManager(emit)
    await manager.create('/tmp/project')
    session.emit({ type: 'message_update', message: assistant(), assistantMessageEvent: { type: 'text_delta', delta: 'retrying', contentIndex: 0, partial: assistant() } } as AgentSessionEvent)
    session.emit({ type: 'agent_end', messages: [], willRetry: true } as AgentSessionEvent)
    expect(emit).not.toHaveBeenCalledWith('retry-session', { type: 'done' })

    session.emit({ type: 'agent_settled' } as AgentSessionEvent)
    expect(emit).toHaveBeenCalledWith('retry-session', { type: 'done' })
    expect(emit.mock.calls.map(([, event]) => event.type)).toEqual(['text_delta', 'done'])
    session.emit({ type: 'agent_settled' } as AgentSessionEvent)
    expect(emit.mock.calls.map(([, event]) => event.type)).toEqual(['text_delta', 'done'])
  })

  it('emits done immediately when an agent turn will not retry', async () => {
    manager = new PiSessionManager(emit)
    await manager.create('/tmp/project')
    session.emit({ type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent)
    expect(emit).toHaveBeenCalledWith('retry-session', { type: 'done' })
    session.emit({ type: 'agent_settled' } as AgentSessionEvent)
    expect(emit.mock.calls.map(([, event]) => event.type)).toEqual(['done'])
  })
})
