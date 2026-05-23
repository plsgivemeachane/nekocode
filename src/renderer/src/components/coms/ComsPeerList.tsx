/**
 * ComsPeerList — Displays discoverable peer agents in the coms pool.
 *
 * Shows a compact list of agents with their name, model, status,
 * and context window usage. Inbound messages are displayed for awareness.
 *
 * Note: The coms "send" feature is Pi-to-Pi M2M communication only.
 * The "Send message" button and QuickSendModal have been removed as
 * they are not intended for direct user interaction.
 *
 * Designed to be embedded in the sidebar or as a collapsible panel.
 */

import { useState, useCallback } from 'react'
import type { ComsPeer, ComsInboundEvent } from '../../../../shared/ipc-types'
import { useComs } from '../../hooks/useComs'

/** Maximum number of peer rows visible before scrolling */
const MAX_VISIBLE_PEERS = 3
/** Approximate height of a single peer row in px (used for scroll container max-height) */
const PEER_ROW_HEIGHT_PX = 44

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
}: {
  peer: ComsPeer
  color: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  /** Copy the peer session ID to clipboard with brief feedback */
  const handleCopyId = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(peer.sessionId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [peer.sessionId])

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

        {/* Copy peer ID button — useful for multi-agent workflows */}
        <button
          className="
            shrink-0 ml-1 p-0.5 rounded
            text-gray-600 hover:text-gray-300
            hover:bg-white/10
            transition-colors
            opacity-0 group-hover:opacity-100
          "
          onClick={handleCopyId}
          title={copied ? 'Copied!' : `Copy peer ID: ${peer.sessionId}`}
        >
          {copied ? (
            <svg className="w-3 h-3 text-green-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" strokeLinecap="round" />
            </svg>
          )}
        </button>
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
          {/* Session ID with copy button — useful for multi-agent workflow targeting */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">ID:</span>
            <span className="text-gray-500 font-mono truncate" title={peer.sessionId}>
              {peer.sessionId.length > 16 ? peer.sessionId.slice(0, 8) + '...' + peer.sessionId.slice(-6) : peer.sessionId}
            </span>
            <button
              className="
                p-0.5 rounded text-gray-500 hover:text-gray-300
                hover:bg-white/10 transition-colors
              "
              onClick={handleCopyId}
              title="Copy full peer ID"
            >
              {copied ? (
                <svg className="w-3 h-3 text-green-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="5" y="5" width="9" height="9" rx="1.5" />
                  <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

/** An inbound message notification card */
function InboundCard({
  message,
  onDismiss,
}: {
  message: ComsInboundEvent
  onDismiss: (msgId: string) => void
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
      {/* Reply removed — coms send is Pi-to-Pi M2M only, not user-facing */}
    </div>
  )
}



// ━━ Main component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function ComsPeerList({ enabled }: { enabled?: boolean }) {
  const { peers, loading, error, inboundMessages, refresh, dismissInbound } = useComs(enabled)
  const [collapsed, setCollapsed] = useState(false)

  // Note: The coms 'send' feature is Pi-to-Pi M2M communication, not user-facing.
  // The 'Send message' button and QuickSendModal have been removed intentionally.
  // Inbound messages are still displayed for awareness, but replies go through
  // the agent's own session, not through a user-facing send modal.

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
                />
              ))}
            </div>
          )}

          {/* Peer list — scrollable when more than MAX_VISIBLE_PEERS */}
          {peers.length === 0 && !loading ? (
            <div className="px-2 py-3 text-[11px] text-gray-500 text-center">
              No peer agents discovered
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ maxHeight: `${MAX_VISIBLE_PEERS * PEER_ROW_HEIGHT_PX}px` }}
            >
              {peers.map((peer, i) => (
                <PeerRow
                  key={peer.sessionId}
                  peer={peer}
                  color={peerColor(peer, i)}
                />
              ))}
            </div>
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


    </div>
  )
}
