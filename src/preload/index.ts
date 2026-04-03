import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  SessionCreateResult,
  SessionReconnectResult,
  ChatMessageIPC,
  SessionStreamEvent,
  ProjectInfo,
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

  reconnect: (sessionId: string, cwd: string): Promise<SessionReconnectResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_RECONNECT, { sessionId, cwd }),

  loadHistory: (sessionId: string): Promise<ChatMessageIPC[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD_HISTORY, { sessionId }),

  onEvent: (callback: (payload: { sessionId: string; event: SessionStreamEvent }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; event: SessionStreamEvent }) => {
      callback(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_EVENTS, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SESSION_EVENTS, handler)
    }
  },
}

const projectApi: NekoCodeIPC['project'] = {
  add: (path: string): Promise<ProjectInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_ADD, { path }),

  remove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REMOVE, { id }),

  list: (): Promise<ProjectInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),

  sessions: (projectId: string): Promise<ProjectInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SESSIONS, { projectId }),
}

contextBridge.exposeInMainWorld('nekocode', {
  version: '0.1.0',
  session: sessionApi,
  project: projectApi,
  dialog: {
    openFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER),
  },
})
