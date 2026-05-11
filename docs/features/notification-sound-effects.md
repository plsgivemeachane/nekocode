# Notification & Custom Sound Effects

> **Status:** Planned | **Priority:** High | **Dependencies:** Zero new packages

## Overview

Add OS-level notifications and custom sound effects that play when long-running tasks complete in NekoCode. The primary use case is notifying users when an AI response finishes while they're working in another window.

## Research Sources

- [Electron Notification API (v42)](https://electronjs.org/docs/latest/api/notification)
- [Electron Notifications Tutorial](https://electronjs.org/docs/latest/tutorial/notifications)
- [SO: How to play a custom sound in Electron](https://stackoverflow.com/questions/61833605/how-to-play-a-custom-sound-in-electron)
- [SO: Playing audio in Electron from main process](https://stackoverflow.com/questions/60601215/playing-audio-in-electron-from-main-process)
- [MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [DEV: Zero-dependency audio synth with Web Audio API](https://dev.to/hexshift/how-to-build-a-zero-dependency-audio-synth-in-the-browser-using-web-audio-api-1bp5)
- [modernweb: Creating sound with oscillators](https://modernweb.com/creating-sound-web-audio-api-oscillators/)
- [DEV: Proper Windows Notifications on Electron](https://dev.to/randomengy/proper-windows-notifications-on-electron-38jo)
- [Electron GH #30904: Focus stealing](https://github.com/electron/electron/issues/30904)
- [Reddit: Notification with custom sounds best practices](https://www.reddit.com/r/electronjs/comments/zz8ea0/notification_with_custom_sounds_best_practices/)

---

## Key Technical Decisions

### 1. `Notification.sound` is macOS-Only -- Must Use Separate Audio

The `sound` property on Electron's `Notification` options is **silently ignored on Windows and Linux**. The universal pattern is:

```typescript
new Notification({
  title: 'Task Complete',
  body: 'AI response is ready',
  silent: true  // Suppress OS default sound on all platforms
}).show();

// Play custom sound separately in renderer
new Audio(soundUrl).play();
```

### 2. Synthesized Sounds (Zero Audio Files) as Default

Use the Web Audio API's `OscillatorNode` + `GainNode` to generate notification sounds programmatically. This means:

- Zero asset files to bundle
- Zero external dependencies
- Instant availability
- Users can optionally upload custom MP3s later

### 3. Focus-Aware Behavior

- **App focused** -> play sound only (no OS notification)
- **App backgrounded** -> OS notification + sound
- This avoids spamming notifications when the user is actively watching the AI respond

### 4. Main Process Notification, Renderer Process Sound

- `Electron.Notification` runs in the main process (required)
- Sound playback runs in the renderer via Web Audio API
- Communication via existing IPC bridge

---

## Architecture

### Data Flow

```text
Main Process                              Renderer Process
-----------                             ---------------
session-manager.ts
  | (stream done)
  v
notification-service.ts (NEW)
  |
  +- Check: isAppFocused?
  |   +- YES -> IPC -> sound only
  |   +- NO  -> Electron.Notification.show()
  |              + IPC -> sound
  |
  +- webContents.send(
      'notification:play-sound',
      { soundKey: 'task-complete' }
    )
                                           v
                                        sound-manager.ts (NEW)
                                          +- Cached AudioContext (singleton)
                                          +- Synthesized chime (default)
                                          +- OR custom MP3 (user override)
```

### New Files

| File | Location | Purpose |
|---|---|---|
| `notification-service.ts` | `src/main/` | Focus-aware notification dispatch, settings persistence |
| `sound-manager.ts` | `src/renderer/src/utils/` | AudioContext singleton, synthesized sounds, custom sound loading |

### Modified Files

| File | Change |
|---|---|
| `src/shared/ipc-channels.ts` | Add notification IPC channel constants |
| `src/shared/ipc-types.ts` | Add `NotificationPayload`, `NotificationSettings` types |
| `src/main/ipc-handlers.ts` | Register notification IPC handlers |
| `src/preload/index.ts` | Expose notification IPC to renderer |
| `src/main/index.ts` | Add `app.setAppUserModelId()` for Windows notifications |
| `src/main/session-manager.ts` | Hook into stream completion to trigger notification |

---

## API Design

### IPC Channels

```typescript
// Add to src/shared/ipc-channels.ts
NOTIFICATION_PLAY_SOUND: 'notification:play-sound',
NOTIFICATION_SETTINGS_GET: 'notification:settings-get',
NOTIFICATION_SETTINGS_SET: 'notification:settings-set',
```

### Shared Types

```typescript
// Add to src/shared/ipc-types.ts

export interface NotificationPayload {
  title: string;
  body: string;
  soundKey: 'task-complete' | 'success' | 'error' | 'warning';
}

export interface NotificationSettings {
  enabled: boolean;             // Master toggle
  soundEnabled: boolean;        // Sound on/off (independent of visual notification)
  soundVolume: number;          // 0.0 - 1.0
  useCustomSounds: boolean;     // false = synthesized, true = user-uploaded MP3s
  tasks: {
    aiResponseComplete: boolean;
    fileOperationComplete: boolean;
    extensionOperationComplete: boolean;
  };
}
```

### Main Process: `notification-service.ts`

```typescript
// Pseudocode for the service interface
class NotificationService {
  constructor(win: BrowserWindow)

  /** Main entry point -- called by session-manager, project-manager, etc. */
  notify(payload: NotificationPayload): void
  // 1. Check if app is focused via BrowserWindow.getFocusedWindow()
  // 2. If focused: only send IPC play-sound to renderer
  // 3. If not focused: show Electron.Notification + send IPC play-sound
  // 4. Debounce: if previous notification < 2s ago, replace it using `id`

  getSettings(): NotificationSettings
  updateSettings(partial: Partial<NotificationSettings>): void
  // Persist to JSON config file or electron-store
}
```

### Renderer: `sound-manager.ts`

```typescript
// Pseudocode for the sound manager
class SoundManager {
  private ctx: AudioContext | null = null;  // Singleton
  private customSounds: Map<string, HTMLAudioElement> = new Map();

  /** Initialize -- call once at app startup */
  init(): void
  // Create singleton AudioContext
  // Listen for 'notification:play-sound' IPC events

  /** Play a synthesized notification sound */
  private playChime(volume: number): void
  // Two-tone ascending sine wave (880Hz -> 1320Hz)
  // ADSR envelope: 50ms attack, 400ms decay
  // Uses exponentialRampToValueAtTime to avoid clipping

  private playSuccess(volume: number): void
  // Single high sine tone (C6 = 1046.5Hz), 500ms

  private playError(volume: number): void
  // Low square wave (150Hz), 300ms -- buzzy feel

  private playWarning(volume: number): void
  // Medium triangle wave (440Hz), 500ms

  /** Route to correct sound by key */
  play(soundKey: string, volume: number): void
  // If useCustomSounds && customSounds.has(key): play MP3
  // Else: play synthesized sound
}
```

### Synthesized Sound Presets

| Sound Key | Waveform | Frequency | Duration | Character |
|---|---|---|---|---|
| `task-complete` | Sine (2-note) | 880Hz -> 1320Hz | ~500ms | Pleasant ascending chime |
| `success` | Sine | 1046.5Hz (C6) | ~500ms | Clean ding |
| `error` | Square | 150Hz | ~300ms | Low buzzy thud |
| `warning` | Triangle | 440Hz | ~500ms | Gentle alert |

---

## Integration Points

### Phase 1: AI Response Complete (Highest Impact)

**File:** `src/main/session-manager.ts`
**Hook:** After the stream `done` event fires

```typescript
// In session-manager.ts, after stream completes:
this.notificationService?.notify({
  title: 'AI Response Ready',
  body: `Session: ${sessionName}`,
  soundKey: 'task-complete'
});
```

### Phase 4: Extended Triggers (Lower Priority)

| Trigger | File | Sound Key |
|---|---|---|
| Bulk file operation complete | `project-manager.ts` | `success` |
| Extension enabled/loaded | `extension-loader.ts` | `success` |
| Build/package complete | Build pipeline hooks | `success` |
| Operation failed (any) | Error handlers | `error` |

---

## Platform-Specific Requirements

### Windows (Primary Platform)

- **Must** call `app.setAppUserModelId(process.execPath)` in `src/main/index.ts` during development
- In production, electron-builder/Squirrel handles this automatically
- Use `Notification.handleActivation()` for click-to-focus (survives GC, app restart, cold start)
- `toastXml` available for fully custom notification templates (future)

### macOS

- App **must be code-signed** for notifications to work (UNNotification API requirement)
- Unsigned builds will emit a `failed` event -- handle gracefully with fallback to sound-only
- `sound` property actually works here, but we use `silent: true` for cross-platform consistency

### Linux

- Uses `libnotify` -- works on GNOME, KDE, Cinnamon, Unity
- `urgency` property available: `'low'` | `'normal'` | `'critical'`
- Gracefully degrade if `libnotify-bin` not installed

---

## Edge Cases & Mitigations

| Issue | Mitigation |
|---|---|
| Multiple `AudioContext` hits hardware limit | Singleton pattern -- one `AudioContext` reused for all sounds |
| Rapid-fire notifications (e.g., quick AI responses) | Debounce with 2s cooldown; replace previous notification using `id` property |
| App focused -> don't show OS notification | Check `BrowserWindow.getFocusedWindow()?.isFocused()` before showing |
| Sound clipping on oscillator stop | Use `exponentialRampToValueAtTime(0.001, ...)` not abrupt gain to 0 |
| macOS unsigned build -> notification `failed` event | Listen for `failed` event; fall back to sound-only mode |
| Windows notification click doesn't focus window | Use `Notification.handleActivation()` (new API, survives GC) |
| Notification shown while previous still visible | Use `id` property to replace/update in-place |
| User switches back to app while notification showing | Notification stays in Action Center -- acceptable behavior |

---

## Implementation Phases

### Phase 1: Core (Highest Value)

**Scope:** Notification service + synthesized sounds + AI response trigger

- [ ] Add `app.setAppUserModelId()` to `src/main/index.ts`
- [ ] Add IPC channels and types to `src/shared/`
- [ ] Create `src/main/notification-service.ts` with focus-aware dispatch
- [ ] Create `src/renderer/src/utils/sound-manager.ts` with synthesized sounds
- [ ] Register IPC handlers in `src/main/ipc-handlers.ts`
- [ ] Expose IPC in `src/preload/index.ts`
- [ ] Hook into `session-manager.ts` stream completion
- [ ] Initialize `SoundManager` in renderer app startup

**Effort:** Small
**Value:** 80% of user value

### Phase 2: Settings & Controls

**Scope:** Persistence, per-task toggles, volume control

- [ ] Add notification settings section to settings UI
- [ ] Implement settings persistence (JSON file or electron-store)
- [ ] Add master toggle, sound toggle, volume slider
- [ ] Add per-task notification toggles
- [ ] Add sound preview buttons (play each sound on click)

**Effort:** Medium
**Value:** High

### Phase 3: Custom Sound Upload

**Scope:** Let users replace synthesized sounds with MP3 files

- [ ] Add file upload UI in settings (one per sound key)
- [ ] Store custom sounds in user data directory
- [ ] Update `SoundManager` to load custom MP3s when configured
- [ ] Add "reset to default" per sound

**Effort:** Medium
**Value:** Medium

### Phase 4: Extended Triggers

**Scope:** File ops, extension ops, build notifications

- [ ] Hook `project-manager.ts` bulk file ops -> `success` sound
- [ ] Hook `extension-loader.ts` lifecycle -> `success` sound
- [ ] Hook build pipeline -> `success` sound
- [ ] Hook error handlers -> `error` sound

**Effort:** Small
**Value:** Medium

---

## Dependencies

**Zero new dependencies.** Everything uses built-in APIs:

- `Electron.Notification` -- built into Electron
- `BrowserWindow.getFocusedWindow()` -- built into Electron
- `Notification.handleActivation()` -- built into Electron (recent versions)
- `Web Audio API` (`AudioContext`, `OscillatorNode`, `GainNode`) -- built into Chromium
- `HTMLAudioElement` -- built into Chromium
- electron-vite asset bundling -- already in the project

---

## Testing Strategy

| Test Type | What to Test |
|---|---|
| Unit | `SoundManager` plays correct synthesized sound per key |
| Unit | `NotificationService` focus check routes to correct branch |
| Unit | Debounce logic replaces notification within cooldown |
| Unit | Settings persistence round-trip |
| Integration | IPC flow: main sends play-sound -> renderer plays audio |
| Integration | Stream complete in session-manager -> notification dispatched |
| Manual | Windows: notification appears in Action Center when app backgrounded |
| Manual | Windows: click notification focuses window |
| Manual | App focused: sound plays, no OS notification |
| Manual | Volume slider affects sound volume |
| Manual | Rapid AI responses don't spam notifications |
