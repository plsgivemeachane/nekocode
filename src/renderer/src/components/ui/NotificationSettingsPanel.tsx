import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { NotificationSettingsContent } from './NotificationSettingsContent'

interface NotificationSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Modal notification settings panel using Radix Dialog.
 * Replaces the old hand-rolled portal + useClickOutside pattern.
 * Also used inline by SettingsView via NotificationSettingsContent.
 */
export function NotificationSettingsPanel({ isOpen, onClose }: NotificationSettingsPanelProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="w-[380px] max-h-[80vh] overflow-y-auto rounded-xl border-surface-700/60 bg-surface-900/95 backdrop-blur-md shadow-2xl shadow-black/50 p-0 gap-0"
        overlayClassName="bg-black/40 backdrop-blur-[2px]"
      >
        {/* Header */}
        <DialogHeader className="flex items-center justify-between px-5 py-4 border-b border-surface-700/40 space-y-0">
          <DialogTitle className="text-[15px] font-semibold text-text-primary font-display tracking-tight">
            Notification Settings
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4">
          <NotificationSettingsContent />
        </div>
      </DialogContent>
    </Dialog>
  )
}
