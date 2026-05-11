import type { NotificationPayload, NotificationSettings, NotificationSoundKey } from '../../../shared/ipc-types'
import { createLogger } from './logger'

const logger = createLogger('sound-manager')

/**
 * Manages notification sound playback in the renderer process.
 *
 * Uses the Web Audio API to synthesize sounds programmatically (zero audio files).
 * Supports optional custom MP3 override per sound key.
 *
 * Singleton -- call init() once at app startup.
 */
class SoundManager {
  private ctx: AudioContext | null = null
  private settings: NotificationSettings = {
    enabled: true,
    soundEnabled: true,
    soundVolume: 0.5,
    useCustomSounds: false,
    tasks: {
      aiResponseComplete: true,
      fileOperationComplete: true,
      extensionOperationComplete: true,
    },
  }
  private customSounds = new Map<string, HTMLAudioElement>()
  private initialized = false
  private cleanupIpc: (() => void) | null = null

  /**
   * Initialize the sound manager.
   * Creates the AudioContext singleton and wires up the IPC listener.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    this.ctx = new AudioContext()

    try {
      this.settings = await window.nekocode.notification.getSettings()
      logger.info('Notification settings loaded')
    } catch (err) {
      logger.warn('Failed to load notification settings, using defaults', err)
    }

    this.cleanupIpc = window.nekocode.notification.onPlaySound((payload) => {
      this.handlePlaySound(payload)
    })

    logger.info('SoundManager initialized')
  }

  dispose(): void {
    this.cleanupIpc?.()
    this.cleanupIpc = null
    this.ctx?.close()
    this.ctx = null
    this.initialized = false
  }

  updateSettings(settings: NotificationSettings): void {
    this.settings = settings
  }

  /**
   * Play a preview sound (for settings UI).
   * Uses current volume setting regardless of soundEnabled toggle.
   */
  playPreview(soundKey: NotificationSoundKey): void {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
    this.playSynthesized(soundKey, this.settings.soundVolume)
  }

  private handlePlaySound(payload: NotificationPayload): void {
    if (!this.settings.soundEnabled) return

    if (this.settings.useCustomSounds && this.customSounds.has(payload.soundKey)) {
      this.playCustom(payload.soundKey, this.settings.soundVolume)
    } else {
      this.playSynthesized(payload.soundKey, this.settings.soundVolume)
    }
  }

  private playCustom(key: string, volume: number): void {
    const audio = this.customSounds.get(key)
    if (!audio) return
    const clone = audio.cloneNode() as HTMLAudioElement
    clone.volume = volume
    clone.play().catch((err) => logger.warn('Custom sound play failed', err))
  }

  private playSynthesized(key: NotificationSoundKey, volume: number): void {
    if (!this.ctx) return

    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }

    switch (key) {
      case 'task-complete':
        this.playChime(volume)
        break
      case 'success':
        this.playSuccess(volume)
        break
      case 'error':
        this.playError(volume)
        break
      case 'warning':
        this.playWarning(volume)
        break
    }
  }

  /**
   * Two-tone ascending sine wave (880Hz -> 1320Hz).
   * ADSR envelope: 50ms attack, 400ms decay.
   */
  private playChime(volume: number): void {
    const ctx = this.ctx!
    const now = ctx.currentTime

    // First tone: 880Hz
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, now)
    gain1.gain.setValueAtTime(0.001, now)
    gain1.gain.exponentialRampToValueAtTime(volume * 0.6, now + 0.05)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.3)

    // Second tone: 1320Hz (offset slightly)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1320, now + 0.15)
    gain2.gain.setValueAtTime(0.001, now + 0.15)
    gain2.gain.exponentialRampToValueAtTime(volume * 0.6, now + 0.2)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.15)
    osc2.stop(now + 0.5)
  }

  /**
   * Single high sine tone (C6 = 1046.5Hz), ~500ms.
   */
  private playSuccess(volume: number): void {
    const ctx = this.ctx!
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1046.5, now)
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(volume * 0.5, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.5)
  }

  /**
   * Low square wave (150Hz), ~300ms -- buzzy feel.
   */
  private playError(volume: number): void {
    const ctx = this.ctx!
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(150, now)
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(volume * 0.4, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.3)
  }

  /**
   * Medium triangle wave (440Hz), ~500ms -- gentle alert.
   */
  private playWarning(volume: number): void {
    const ctx = this.ctx!
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, now)
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(volume * 0.5, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.5)
  }
}

export const soundManager = new SoundManager()
