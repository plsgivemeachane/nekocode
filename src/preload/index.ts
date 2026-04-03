import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  SessionCreateResult,
  SessionStreamEvent,
  NekoCodeIPC,
} from '../shared/ipc-types'

const sessionApi: NekoCodeIPC['session'] = {
  create: (cwd: string): Promise<SessionCreateResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, { cwd }),

  prompt: (sessionId: string, text: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_PROMPT, { sessionId, text }),

  abort: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_ABORT, { sessionId }),

  dispose: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_DISPOSE, { sessionId }),

  onEvent: (callback: (event: SessionStreamEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; event: SessionStreamEvent }) => {
      callback(payload.event)
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_EVENTS, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SESSION_EVENTS, handler)
    }
  },
}

contextBridge.exposeInMainWorld('nekocode', {
  version: '0.1.0',
  session: sessionApi,
})
