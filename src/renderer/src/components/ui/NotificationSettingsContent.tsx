import React, { useState, useEffect, useCallback } from 'react'
import { Switch } from './switch'
import { Slider } from './slider'
import { Label } from './label'
import { soundManager } from '../../utils/sound-manager'
import { createLogger } from '../../utils/logger'
import type { NotificationSettings, NotificationSoundKey } from '../../../../shared/ipc-types'

const logger = createLogger('NotificationSettings')

const SOUND_KEYS: { key: NotificationSoundKey; label: string; description: string }[] = [
  { key: 'task-complete', label: 'Task Complete', description: 'AI response ready' },
  { key: 'success', label: 'Success', description: 'Operation succeeded' },
  { key: 'error', label: 'Error', description: 'Operation failed' },
  { key: 'warning', label: 'Warning', description: 'Attention needed' },
]

/** Hand-rolled Toggle replaced by shadcn Switch in Phase 1D */

/**
 * Inline notification settings content.
 * Used by both the popup NotificationSettingsPanel and the central Settings page.
 * Loads settings on mount and renders the full settings UI.
 */
export function NotificationSettingsContent() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Always load on mount
  useEffect(() => {
    setLoading(true)
    window.nekocode.notification.getSettings().then((s) => {
      setSettings(s)
      setLoading(false)
    }).catch((err) => {
      logger.error('Failed to load settings', err)
      setLoading(false)
    })
  }, [])

  const updateSetting = useCallback(async <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K],
  ) => {
    if (!settings) return
    const next = { ...settings, [key]: value }
    setSettings(next)
    soundManager.updateSettings(next)
    try {
      await window.nekocode.notification.updateSettings({ [key]: value })
    } catch (err) {
      logger.error('Failed to update setting', err)
    }
  }, [settings])

  const updateTaskSetting = useCallback(async (taskKey: keyof NotificationSettings['tasks'], value: boolean) => {
    if (!settings) return
    const next = { ...settings, tasks: { ...settings.tasks, [taskKey]: value } }
    setSettings(next)
    soundManager.updateSettings(next)
    try {
      await window.nekocode.notification.updateSettings({ tasks: { ...settings.tasks, [taskKey]: value } })
    } catch (err) {
      logger.error('Failed to update task setting', err)
    }
  }, [settings])

  const handleVolumeChange = useCallback((values: number[]) => {
    const volume = (values[0] ?? 0) / 100
    if (!settings) return
    const next = { ...settings, soundVolume: volume }
    setSettings(next)
    soundManager.updateSettings(next)
  }, [settings])

  const commitVolume = useCallback(async () => {
    if (!settings) return
    try {
      await window.nekocode.notification.updateSettings({ soundVolume: settings.soundVolume })
    } catch (err) {
      logger.error('Failed to save volume', err)
    }
  }, [settings])

  const handlePreview = useCallback((soundKey: NotificationSoundKey) => {
    soundManager.playPreview(soundKey)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="w-5 h-5 animate-spin text-text-tertiary" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="px-5 py-8 text-center text-[12px] text-text-tertiary">
        Failed to load settings.
      </div>
    )
  }

  return (
    <div className="bg-surface-900/60 rounded-lg border border-surface-800/50 p-4 space-y-5">
      {/* Master toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm text-surface-200 font-medium">Enable Notifications</Label>
          <p className="text-xs text-surface-500 mt-0.5">OS notifications and sounds</p>
        </div>
        <Switch checked={settings.enabled} onCheckedChange={(v) => updateSetting('enabled', v)} />
      </div>

      <div className="h-px bg-surface-700/40" />

      {/* Sound toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm text-surface-200 font-medium">Sound Effects</Label>
          <p className="text-xs text-surface-500 mt-0.5">Play sounds on events</p>
        </div>
        <Switch
          checked={settings.soundEnabled}
          onCheckedChange={(v) => updateSetting('soundEnabled', v)}
          disabled={!settings.enabled}
        />
      </div>

      {/* Volume slider */}
      <div className={`space-y-2 ${!settings.soundEnabled || !settings.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-surface-200">Volume</Label>
          <span className="text-xs text-surface-500 font-mono">{Math.round(settings.soundVolume * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[Math.round(settings.soundVolume * 100)]}
          onValueChange={handleVolumeChange}
          onValueCommit={commitVolume}
          className="w-full"
        />
      </div>

      <div className="h-px bg-surface-700/40" />

      {/* Sound previews */}
      <div className={`space-y-2 ${!settings.soundEnabled || !settings.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <Label className="text-sm text-surface-200 font-medium mb-2.5">Preview Sounds</Label>
        {SOUND_KEYS.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between py-1">
            <div>
              <p className="text-[12px] text-text-primary">{label}</p>
              <p className="text-[10px] text-text-tertiary">{description}</p>
            </div>
            <button
              onClick={() => handlePreview(key)}
              className="p-1.5 text-text-tertiary hover:text-accent-400 hover:bg-surface-800/60 rounded-md transition-colors"
              title={`Preview ${label}`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M5 3l7 5-7 5V3z" fill="currentColor" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="h-px bg-surface-700/40" />

      {/* Per-task toggles */}
      <div className="space-y-3">
        <Label className="text-sm text-surface-200 font-medium">Notify On</Label>

        <div className="flex items-center justify-between">
          <Label className="text-[12px] text-text-primary cursor-pointer">AI response complete</Label>
          <Switch
            checked={settings.tasks.aiResponseComplete}
            onCheckedChange={(v) => updateTaskSetting('aiResponseComplete', v)}
            disabled={!settings.enabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-[12px] text-text-primary cursor-pointer">File operations complete</Label>
          <Switch
            checked={settings.tasks.fileOperationComplete}
            onCheckedChange={(v) => updateTaskSetting('fileOperationComplete', v)}
            disabled={!settings.enabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-[12px] text-text-primary cursor-pointer">Extension operations complete</Label>
          <Switch
            checked={settings.tasks.extensionOperationComplete}
            onCheckedChange={(v) => updateTaskSetting('extensionOperationComplete', v)}
            disabled={!settings.enabled}
          />
        </div>
      </div>
    </div>
  )
}
