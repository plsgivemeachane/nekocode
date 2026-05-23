/**
 * ComsPeerList — Displays discoverable peer agents in the coms pool.
 *
 * Shows a compact list of agents with their name, model, status,
 * and context window usage. Allows sending a quick prompt to any peer.
 *
 * Designed to be embedded in the sidebar or as a collapsible panel.
 */

import { useState, useCallback } from 'react'
import type { ComsPeer, ComsInboundEvent } from '../../../../shared/ipc-types'
import { useComs } from '../../hooks/useComs'

/** Color mapping fallback for agents without a brand color */
const FALLBACK_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#eab308', // yellow
]

/** Get a deterministic color for a peer based on its session ID */
function peerColor(peer: ComsPeer, index: number): string {
  if (peer.color) return peer.color
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/** Context usage bar color based on percentage */
function contextColor(pct: number | null): string {
  if (pct === null) return 'bg-gray-600'
  if (pct < 50) return 'bg-green-500'
  if (pct < 80) return 'bg-yellow-500'
  return 'bg-red-500'
}

// ━━ Sub-components ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** A single peer row in the list */
function PeerRow({
  peer,
  color,
  onSend,
}: {
  peer: ComsPeer
  color: string
  onSend: (peer: ComsPeer) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="
        group peer-row
        flex flex-col gap-1
        px-2 py-1.5 rounded-md
        hover:bg-white/5
        transition-colors cursor-pointer
        border border-transparent
        hover:border-white/10
      "
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Status indicator */}
        <span
          className={`
            inline-block w-2 h-2 rounded-full shrink-0
            ${peer.alive ? 'bg-green-400' : 'bg-gray-500'}
          `}
          title={peer.alive ? 'Online' : 'Offline'}
        />

        {/* Color badge */}
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: color }}
        />

        {/* Name */}
        <span className="text-xs font-medium text-gray-200 truncate flex-1" title={peer.name}>
          {peer.name}
        </span>

        {/* Model tag */}
        <span className="text-[10px] text-gray-500 truncate max-w-[80px]" title={peer.model}>
          {peer.model.split('/').pop()}
        </span>
      </div>

      {/* Context usage bar (if available) */}
      {peer.contextUsedPct !== null && (
        <div className="flex items-center gap-1.5 pl-6">
          <div className="flex-1 h-1 rounded-full bg-gray-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${contextColor(peer.contextUsedPct)}`}
              style={{ width: `${Math.min(peer.contextUsedPct, 100)}%` }}
            />
          </div>
          <span className="text-[9px] text-gray-500 tabular-nums w-7 text-right">
            {Math.round(peer.contextUsedPct)}%
          </span>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="pl-6 pt-1 space-y-1 text-[11px] text-gray-400">
          {peer.purpose && (
            <p className="italic" title={peer.purpose}>
              {peer.purpose.length > 60 ? peer.purpose.slice(0, 57) + '...' : peer.purpose}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Project:</span>
            <span>{peer.project}</span>
          </div>
          <button
            className="
              mt-1 px-2 py-0.5 rounded text-[10px]
              bg-white/5 hover:bg-white/10
              text-gray-300 hover:text-white
              border border-white/10 hover:border-white/20
              transition-colors
            "
            onClick={(e) => {
              e.stopPropagation()
              onSend(peer)
            }}
          >
            Send message
          </button>
        </div>
      )}
    </div>
  )
}

/** An inbound message notification card */
function InboundCard({
  message,
  onDismiss,
  onReply,
}: {
  message: ComsInboundEvent
  onDismiss: (msgId: string) => void
  onReply: (senderName: string, conversationId?: string | null) => void
}) {
  return (
    <div className="
      flex flex-col gap-1
      px-2 py-1.5 rounded-md
      bg-accent-500/10 border border-accent-500/20
    ">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-accent-400">FROM</span>
        <span className="text-xs text-gray-200 font-medium">{message.senderName}</span>
        <button
          className="ml-auto text-gray-500 hover:text-gray-300 text-xs"
          onClick={() => onDismiss(message.msgId)}
        >
          ✕
        </button>
      </div>
      <p className="text-[11px] text-gray-300 leading-snug">{message.prompt}</p>
      <button
        className="
          mt-0.5 self-start
          px-2 py-0.5 rounded text-[10px]
          bg-accent-500/20 hover:bg-accent-500/30
          text-accent-300 hover:text-accent-200
          border border-accent-500/20 hover:border-accent-500/30
          transition-colors
        "
        onClick={() => onReply(message.senderName, message.conversationId)}
      >
        Reply
      </button>
    </div>
  )
}

/** Quick-send modal */
function QuickSendModal({
  peer,
  onSend,
  onClose,
}: {
  peer: ComsPeer
  onSend: (target: string, prompt: string) => Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await onSend(peer.name, text.trim())
      onClose()
    } catch {
      // Error is handled by the hook
    } finally {
      setSending(false)
    }
  }, [text, sending, peer.name, onSend, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="
          bg-gray-900 border border-white/10 rounded-lg
          p-4 w-80 shadow-xl
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">
            Message → {peer.name}
          </h3>
          <button
            className="text-gray-500 hover:text-gray-300 text-sm"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <textarea
          className="
            w-full h-24 rounded-md
            bg-gray-800 border border-white/10
            text-gray-200 text-xs p-2
            resize-none
            focus:outline-none focus:border-accent-500/50
          "
          placeholder="Type your prompt..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
          }}
          autoFocus
        />
        <div className="flex items-center justify-end gap-2 mt-2">
          <span className="text-[10px] text-gray-500">Ctrl+Enter to send</span>
          <button
            className="
              px-3 py-1 rounded text-xs
              bg-accent-500/20 hover:bg-accent-500/30
              text-accent-300 hover:text-accent-200
              border border-accent-500/20
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
            onClick={handleSend}
            disabled={sending || !text.trim()}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ━━ Main component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function ComsPeerList({ enabled }: { enabled?: boolean }) {
  const { peers, loading, error, inboundMessages, refresh, send, dismissInbound } = useComs(enabled)
  const [showSendModal, setShowSendModal] = useState<ComsPeer | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const handleQuickSend = useCallback(async (target: string, prompt: string) => {
    await send({ target, prompt })
  }, [send])

  const handleReply = useCallback((senderName: string, _conversationId?: string | null) => {
    // Find the peer by name and open the send modal
    const peer = peers.find(p => p.name === senderName)
    if (peer) {
      setShowSendModal(peer)
    }
  }, [peers])

  const aliveCount = peers.filter(p => p.alive).length

  return (
    <div className="flex flex-col">
      {/* Header */}
      <button
        className="
          flex items-center gap-2 px-3 py-2 w-full
          hover:bg-white/5 transition-colors
          text-left
        "
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}>▸</span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">
          Peer Agents
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {aliveCount}/{peers.length}
        </span>
        {loading && (
          <span className="text-[10px] text-accent-400 animate-pulse">⟳</span>
        )}
      </button>

      {/* Collapsible content */}
      {!collapsed && (
        <div className="px-1 space-y-0.5">
          {/* Error banner */}
          {error && (
            <div className="px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded">
              {error}
            </div>
          )}

          {/* Inbound messages */}
          {inboundMessages.length > 0 && (
            <div className="space-y-1 pb-1">
              {inboundMessages.map((msg) => (
                <InboundCard
                  key={msg.msgId}
                  message={msg}
                  onDismiss={dismissInbound}
                  onReply={handleReply}
                />
              ))}
            </div>
          )}

          {/* Peer list */}
          {peers.length === 0 && !loading ? (
            <div className="px-2 py-3 text-[11px] text-gray-500 text-center">
              No peer agents discovered
            </div>
          ) : (
            peers.map((peer, i) => (
              <PeerRow
                key={peer.sessionId}
                peer={peer}
                color={peerColor(peer, i)}
                onSend={setShowSendModal}
              />
            ))
          )}

          {/* Refresh button */}
          <button
            className="
              w-full px-2 py-1 mt-1 rounded text-[10px]
              text-gray-500 hover:text-gray-300
              hover:bg-white/5 transition-colors
            "
            onClick={refresh}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      )}

      {/* Quick-send modal */}
      {showSendModal && (
        <QuickSendModal
          peer={showSendModal}
          onSend={handleQuickSend}
          onClose={() => setShowSendModal(null)}
        />
      )}
    </div>
  )
}
