import React, { useEffect, useRef } from 'react'
import type { UISelectOption } from '../../../../shared/ipc-types'
import type { PendingUIRequest, UIDialogLocalState } from '../../hooks/useUIRequests'

/** Props shared by all dialog variants */
interface UIDialogBaseProps {
  /** The pending request with its local state */
  pending: PendingUIRequest
  /** Update local dialog state */
  updateLocalState: (patch: Partial<UIDialogLocalState>) => void
  /** Confirm the dialog */
  onConfirm: (selectedValue?: string, inputValue?: string) => void
  /** Cancel the dialog */
  onCancel: () => void
}

// ── Select Dialog ──────────────────────────────────────────────────

function SelectDialogContent({ pending, updateLocalState, onConfirm, onCancel }: UIDialogBaseProps) {
  const options: UISelectOption[] = pending.request.options ?? []
  const { highlightedIndex } = pending.localState
  const listRef = useRef<HTMLDivElement>(null)

  // Keyboard navigation for options
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          updateLocalState({ highlightedIndex: Math.min(highlightedIndex + 1, options.length - 1) })
          break
        case 'ArrowUp':
          e.preventDefault()
          updateLocalState({ highlightedIndex: Math.max(highlightedIndex - 1, 0) })
          break
        case 'Enter':
          e.preventDefault()
          if (highlightedIndex >= 0 && highlightedIndex < options.length) {
            const opt = options[highlightedIndex]
            onConfirm(opt.value ?? opt.label)
          }
          break
        case 'Escape':
          e.preventDefault()
          onCancel()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [highlightedIndex, options, updateLocalState, onConfirm, onCancel])

  // Auto-scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  return (
    <>
      {pending.request.description && (
        <p className="text-sm text-text-secondary mb-3 leading-relaxed">{pending.request.description}</p>
      )}
      <div ref={listRef} className="max-h-60 overflow-y-auto rounded-lg border border-surface-700/60 bg-surface-900/80">
        {options.map((opt, idx) => {
          const isHighlighted = idx === highlightedIndex
          return (
            <button
              key={opt.value ?? opt.label}
              onClick={() => onConfirm(opt.value ?? opt.label)}
              onMouseEnter={() => updateLocalState({ highlightedIndex: idx })}
              className={`w-full text-left px-3.5 py-2.5 transition-colors border-b border-surface-800/40 last:border-b-0 ${
                isHighlighted
                  ? 'bg-accent-400/10 text-text-primary'
                  : 'text-text-secondary hover:bg-surface-800/40'
              }`}
            >
              <span className="text-sm font-medium">{opt.label}</span>
              {opt.description && (
                <span className="block text-[12px] text-text-muted mt-0.5">{opt.description}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px] text-text-muted font-mono">
        <span>&uarr;&darr; navigate &middot; Enter select &middot; Esc cancel</span>
        <span>{options.length} option{options.length !== 1 ? 's' : ''}</span>
      </div>
    </>
  )
}

// ── Confirm Dialog ─────────────────────────────────────────────────

function ConfirmDialogContent({ pending, onConfirm, onCancel }: UIDialogBaseProps) {
  const isDangerous = pending.request.dangerous ?? false
  const btnRef = useRef<HTMLButtonElement>(null)

  // Auto-focus the confirm button
  useEffect(() => {
    btnRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <>
      {pending.request.description && (
        <p className="text-sm text-text-secondary mb-4 leading-relaxed">{pending.request.description}</p>
      )}
      <div className="flex items-center justify-end gap-2.5">
        <button
          onClick={onCancel}
          className="px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-800/60 rounded-lg border border-surface-700/60 transition-colors"
        >
          Cancel
        </button>
        <button
          ref={btnRef}
          onClick={() => onConfirm()}
          className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors ${
            isDangerous
              ? 'bg-error/15 text-error border-error/30 hover:bg-error/25 hover:border-error/50'
              : 'bg-accent-400/15 text-accent-300 border-accent-400/30 hover:bg-accent-400/25 hover:border-accent-400/50'
          }`}
        >
          {isDangerous ? 'Confirm' : 'OK' }
        </button>
      </div>
    </>
  )
}

// ── Input Dialog ───────────────────────────────────────────────────

function InputDialogContent({ pending, updateLocalState, onConfirm, onCancel }: UIDialogBaseProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { inputValue } = pending.localState

  // Auto-focus the input
  useEffect(() => {
    // Small delay to ensure the dialog is rendered and visible
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (inputValue.trim()) {
          onConfirm(undefined, inputValue.trim())
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [inputValue, onConfirm, onCancel])

  return (
    <>
      {pending.request.description && (
        <p className="text-sm text-text-secondary mb-3 leading-relaxed">{pending.request.description}</p>
      )}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => updateLocalState({ inputValue: e.target.value })}
        placeholder={pending.request.placeholder ?? ''}
        className="w-full px-3 py-2 text-sm bg-surface-900/80 border border-surface-700/60 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-400/50 focus:ring-1 focus:ring-accent-400/20 transition-colors"
      />
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] text-text-muted font-mono">Enter confirm &middot; Esc cancel</span>
        <button
          onClick={() => {
            if (inputValue.trim()) {
              onConfirm(undefined, inputValue.trim())
            }
          }}
          disabled={!inputValue.trim()}
          className="px-3.5 py-1.5 text-sm font-medium rounded-lg border transition-colors bg-accent-400/15 text-accent-300 border-accent-400/30 hover:bg-accent-400/25 disabled:opacity-40 disabled:pointer-events-none"
        >
          Submit
        </button>
      </div>
    </>
  )
}

// ── Main UIDialog Component ────────────────────────────────────────

interface UIDialogProps {
  /** The pending UI request to render, or null to hide */
  pending: PendingUIRequest | null
  /** Update local dialog state */
  updateLocalState: (patch: Partial<UIDialogLocalState>) => void
  /** Confirm the dialog */
  onConfirm: (selectedValue?: string, inputValue?: string) => void
  /** Cancel the dialog */
  onCancel: () => void
}

/**
 * Renders an inline dialog in the chat timeline for extension/workflow UI requests.
 * Supports three types: select, confirm, input.
 * Styled to match the existing ToolCallGroup/ThinkingBlock aesthetic.
 */
export function UIDialog({ pending, updateLocalState, onConfirm, onCancel }: UIDialogProps) {
  // If no pending request, render nothing
  if (!pending) return null

  const { request } = pending

  // Pick the right icon based on type
  const icon = request.type === 'select' ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-accent-400 shrink-0">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : request.type === 'confirm' ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={request.dangerous ? 'text-error' : 'text-accent-400 shrink-0'}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-accent-400 shrink-0">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )

  const typeLabel = request.type === 'select' ? 'Select' : request.type === 'confirm' ? 'Confirm' : 'Input'

  return (
    <div className="rounded-lg border border-accent-400/20 bg-surface-900/60 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-surface-800/60 bg-surface-900/70">
        {icon}
        <span className="text-[12px] font-mono font-medium text-text-secondary">{typeLabel}</span>
        <span className="text-[12px] font-mono text-text-primary truncate flex-1">{request.title}</span>
      </div>

      {/* Body */}
      <div className="px-3.5 py-3">
        {request.type === 'select' && (
          <SelectDialogContent
            pending={pending}
            updateLocalState={updateLocalState}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
        {request.type === 'confirm' && (
          <ConfirmDialogContent
            pending={pending}
            updateLocalState={updateLocalState}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
        {request.type === 'input' && (
          <InputDialogContent
            pending={pending}
            updateLocalState={updateLocalState}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  )
}
