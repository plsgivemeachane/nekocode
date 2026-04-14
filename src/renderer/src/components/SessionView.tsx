import React, { useRef, useEffect } from 'react'
import { useSession } from '../hooks/useSession'
import { createLogger } from '../logger'

const logger = createLogger('SessionView')

interface SessionViewProps {
  sessionId: string
  cwd?: string
  onCreateSession: () => Promise<void>
  onDisposeSession: () => Promise<void>
}

export function SessionView({ sessionId, cwd, onCreateSession, onDisposeSession }: SessionViewProps) {
  const {
    isStreaming,
    messages,
    error,
    sendPrompt,
    input,
    setInput,
    activeModel,
    modelList,
    setModel,
  } = useSession({ sessionId })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showModelDropdown, setShowModelDropdown] = React.useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showModelDropdown])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    logger.info(`submit: ${text.slice(0, 80)}`)
    await sendPrompt(text)
  }

  const handleNewSession = async () => {
    logger.info('new session requested')
    if (sessionId) {
      await onDisposeSession()
    }
    await onCreateSession()
  }

  return (
    <div className="min-h-screen bg-surface-950 text-text-primary flex flex-col">
      <header className="border-b border-surface-800 px-6 py-3.5 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight"><span className="text-pink-400">Neko</span><span className="text-white">code</span></h1>
        <div className="flex items-center gap-3">
          {cwd && (
            <span className="text-xs text-text-tertiary font-mono truncate max-w-xs" title={cwd}>
              {cwd}
            </span>
          )}
          <button
            onClick={handleNewSession}
            disabled={isStreaming}
            className="px-3 py-1.5 text-sm bg-surface-800 text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors duration-200"
          >
            {sessionId ? 'New Session' : 'New Session'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-4">
        {!sessionId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-tertiary">Click &quot;New Session&quot; to select a project folder.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-tertiary">Session ready. Type a prompt below.</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg) => {
              let text: string
              if (msg.role === 'user') {
                text = msg.content
              } else if (msg.type === 'text') {
                text = msg.content
              } else {
                const status = msg.status === 'running' ? '...' : msg.isError ? ' (error)' : ' (done)'
                text = `[${msg.toolName}${status}]`
              }
              return (
                <pre key={msg.id} className="whitespace-pre-wrap break-words text-sm text-text-primary font-mono bg-surface-900 rounded-lg p-4 border border-surface-800">
                  {text}
                </pre>
              )
            })}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-accent-400 animate-glow-pulse ml-1" />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {error && (
        <div className="px-6 py-2 bg-error-surface border-t border-error/30 text-error text-sm">
          {error}
        </div>
      )}

      <footer className="px-6 py-4 bg-surface-950">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit}>
            <div className="rounded-[1.25rem] border border-accent-500/70 bg-surface-900 p-4 shadow-[0_0_30px_oklch(0.75_0.15_195/0.06)]">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything, @tag files/folders, or use / to show available commands"
                disabled={!sessionId || isStreaming}
                className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary/50 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed"
              />
              <div className="flex items-center justify-between mt-2 pt-2">
                <div className="flex items-center gap-0 text-xs text-text-secondary">
                  <div ref={modelDropdownRef} className="relative">
                    <button type="button" onClick={() => setShowModelDropdown(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface-800 transition-colors duration-150">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-400">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <span>{activeModel ? activeModel.name : "Loading..."}</span>
                      <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-tertiary"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {showModelDropdown && modelList.length > 0 && (
                      <div className="absolute bottom-full left-0 mb-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-xl p-2 max-h-64 overflow-y-auto z-50">
                        {modelList.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setModel(m.provider, m.id); setShowModelDropdown(false) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-700 transition-colors flex items-center justify-between ${activeModel?.id === m.id ? "text-accent-400" : "text-text-secondary"}`}
                          >
                            <span>{m.name}</span>
                            <span className="text-text-tertiary text-[10px] ml-2">{m.provider}</span>
                          </button>
                        ))}
                        {modelList.length === 0 && (
                          <div className="px-3 py-2 text-xs text-text-tertiary">No models configured</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!sessionId || isStreaming || !input.trim()}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-accent-700 text-white hover:bg-accent-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-accent-700/25 hover:shadow-accent-600/35"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </form>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 4v8a2 2 0 002 2h8a2 2 0 002-2V4M2 4l2-2h8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Local
            </span>
            <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
              main
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
