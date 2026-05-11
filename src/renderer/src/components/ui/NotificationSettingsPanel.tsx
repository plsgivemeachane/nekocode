import React, { useRef } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'
import { NotificationSettingsContent } from './NotificationSettingsContent'

interface NotificationSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function NotificationSettingsPanel({ isOpen, onClose }: NotificationSettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useClickOutside(panelRef, isOpen, onClose)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div
        ref={panelRef}
        className="w-[380px] max-h-[80vh] overflow-y-auto rounded-xl border border-surface-700/60 bg-surface-900/95 backdrop-blur-md shadow-2xl shadow-black/50"
        role="dialog"
        aria-label="Notification Settings"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700/40">
          <h2 className="text-[15px] font-semibold text-text-primary font-display tracking-tight">Notification Settings</h2>
          <button
            onClick={onClose}
            className="p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-800/60 rounded-md transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          <NotificationSettingsContent />
        </div>
      </div>
    </div>
  )
}
