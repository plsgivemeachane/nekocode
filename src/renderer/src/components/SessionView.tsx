import { useState, useRef, useEffect } from 'react'
import { useSession } from '../hooks/useSession'

export function SessionView() {
  const {
    sessionId,
    cwd,
    isStreaming,
    messages,
    error,
    createSession,
    sendPrompt,
    disposeSession,
  } = useSession()

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    await sendPrompt(text)
  }

  const handleNewSession = async () => {
    if (sessionId) {
      await disposeSession()
    }
    await createSession()
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">NekoCode</h1>
        <div className="flex items-center gap-3">
          {cwd && (
            <span className="text-xs text-zinc-500 font-mono truncate max-w-xs" title={cwd}>
              {cwd}
            </span>
          )}
          <button
            onClick={handleNewSession}
            disabled={isStreaming}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            {sessionId ? 'New Session' : 'New Session'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-4">
        {!sessionId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500">Click &quot;New Session&quot; to select a project folder.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500">Session ready. Type a prompt below.</p>
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
                <pre key={msg.id} className="whitespace-pre-wrap break-words text-sm text-zinc-300 font-mono bg-zinc-900 rounded-lg p-4">
                  {text}
                </pre>
              )
            })}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {error && (
        <div className="px-6 py-2 bg-red-950/50 border-t border-red-900 text-red-400 text-sm">
          {error}
        </div>
      )}

      <footer className="border-t border-zinc-800 px-6 py-3">
        <form onSubmit={handleSubmit} className="flex gap-3 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={sessionId ? 'Type a prompt...' : 'Create a session first'}
            disabled={!sessionId || isStreaming}
            className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!sessionId || isStreaming || !input.trim()}
            className="px-4 py-2 text-sm bg-zinc-100 text-zinc-900 font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  )
}
