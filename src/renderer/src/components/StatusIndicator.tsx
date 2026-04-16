import React, { useState, useEffect } from 'react'
import type { UsageData } from '../../../shared/ipc-types'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function fmt(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs > 0 ? rs + 's' : ''}`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm > 0 ? rm + 'm' : ''}`
}

function pctColor(pct: number): string {
  if (pct > 75) return 'text-error'
  if (pct > 50) return 'text-text-accent'
  return 'text-success'
}

interface StatusIndicatorProps {
  isStreaming: boolean
  isAgentConnecting: boolean
  modelName: string | null
  usage: UsageData
  streamStartTime: number
}

export function StatusIndicator({ isStreaming, isAgentConnecting, modelName, usage, streamStartTime }: StatusIndicatorProps) {
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isStreaming && !isAgentConnecting && streamStartTime === 0) return
    const spinInterval = setInterval(() => {
      setFrame(prev => (prev + 1) % SPINNER_FRAMES.length)
    }, 80)
    const timeInterval = setInterval(() => {
      if (streamStartTime > 0) {
        setElapsed(Date.now() - streamStartTime)
      }
    }, 1000)
    return () => {
      clearInterval(spinInterval)
      clearInterval(timeInterval)
    }
  }, [isStreaming, isAgentConnecting, streamStartTime])

    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0

  return (
    <div className="flex items-center gap-2 py-1 select-none font-mono text-xs">
      {/* Model name */}
      {modelName && (
        <span className="text-accent-400 truncate max-w-[200px]" title={modelName}>
          {modelName}
        </span>
      )}

      {hasUsage && (
        <>
          <Separator />
          {/* Token usage: input / output */}
          <span className="text-text-tertiary">
            <span title="Input tokens">▸ {fmt(usage.inputTokens)}</span>
            <span className="text-text-tertiary/50 mx-1">/</span>
            <span title="Output tokens">▴ {fmt(usage.outputTokens)}</span>
          </span>

          {/* Cost */}
          {usage.totalCost > 0 && (
            <>
              <Separator />
              <span className="text-text-accent" title="Total cost">
                ${usage.totalCost.toFixed(2)}
              </span>
            </>
          )}

          {/* Context % */}
          {usage.contextWindow > 0 && (
            <>
              <Separator />
              <span className={pctColor(usage.contextPercent)} title={`Context: ${usage.contextPercent.toFixed(0)}%`}>
                ◆ {usage.contextPercent.toFixed(0)}%
              </span>
            </>
          )}
        </>
      )}

      {/* Elapsed time */}
      {elapsed > 0 && (
        <>
          <Separator />
          <span className="text-text-tertiary" title="Elapsed time">
            {formatElapsed(elapsed)}
          </span>
        </>
      )}

      {/* Status */}
      <span className="flex-1" />
      {isAgentConnecting ? (
        <span className="text-warning-400">
          <span className="inline-block w-[1ch] text-center">{SPINNER_FRAMES[frame]}</span>
          <span className="text-text-tertiary ml-1">Connecting</span>
        </span>
      ) : isStreaming ? (
        <span className="text-accent-400">
          <span className="inline-block w-[1ch] text-center">{SPINNER_FRAMES[frame]}</span>
          <span className="text-text-tertiary ml-1">Working</span>
        </span>
      ) : (
        <span className="text-success">Ready</span>
      )}
    </div>
  )
}

function Separator() {
  return <span className="text-text-tertiary/30 mx-1">│</span>
}
