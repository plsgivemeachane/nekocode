import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  SessionCreateResult,
  SessionReconnectResult,
  ChatMessageIPC,
  SessionStreamEvent,
  ProjectInfo,
  NekoCodeIPC,
  WorkspaceSetActivePayload,
  WorkspaceActiveResult,
  ModelInfo,
  CommandInfo,
  UpdateAvailableInfo,
  UpdateProgress,
  UpdateErrorInfo,
  ZoomInfo,
  NotificationPayload,
  NotificationSettings,
  ShellApi,
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
  deleteSession: (sessionId: string, cwd: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, { sessionId, cwd }),

  reconnect: (sessionId: string, cwd: string): Promise<SessionReconnectResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_RECONNECT, { sessionId, cwd }),

  loadHistory: (sessionId: string): Promise<ChatMessageIPC[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD_HISTORY, { sessionId }),

  loadHistoryFromDisk: (sessionId: string, cwd: string, limit: number): Promise<ChatMessageIPC[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD_HISTORY_DISK, { sessionId, cwd, limit }),

  onEvent: (callback: (payload: { sessionId: string; event: SessionStreamEvent }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; event: SessionStreamEvent }) => {
      callback(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_EVENTS, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SESSION_EVENTS, handler)
    }
  },

  getModel: (sessionId: string): Promise<ModelInfo | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_MODEL, { sessionId }),

  listModels: (): Promise<ModelInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST_MODELS),

  setModel: (sessionId: string, provider: string, modelId: string): Promise<ModelInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_SET_MODEL, { sessionId, provider, modelId }),

  getCommands: (sessionId: string): Promise<CommandInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_COMMANDS, { sessionId }),

  /** Respond to a UI request (select/confirm/input) from an extension or workflow */
  uiRespond: (response: import('../shared/ipc-types').UIResponse): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_UI_RESPOND, response),

  /** Listen for UI requests from extensions/workflows */
  onUIRequest: (callback: (request: import('../shared/ipc-types').UIRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; event: import('../shared/ipc-types').SessionStreamEvent }) => {
      if (data.event.type === 'ui_request') {
        console.log(`[preload] onUIRequest: received ui_request for session ${data.event.request?.sessionId}, requestId=${data.event.request?.id}`)
        callback(data.event.request)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_EVENTS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_EVENTS, handler)
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

const workspaceApi: NekoCodeIPC['workspace'] = {
  setActive: (sessionId: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, { sessionId, projectPath } as WorkspaceSetActivePayload),

  getActive: (): Promise<WorkspaceActiveResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_ACTIVE),
}

contextBridge.exposeInMainWorld('nekocode', {
  version: '0.1.0',
  session: sessionApi,
  project: projectApi,
  workspace: workspaceApi,
  git: {
    getBranch: (cwd: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCH, { cwd }),
    getStatus: (cwd: string): Promise<import('../shared/ipc-types').GitStatusResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, { cwd }),
    getLog: (cwd: string, maxCount?: number): Promise<import('../shared/ipc-types').GitLogResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, { cwd, maxCount }),
    getDiff: (cwd: string, filePath?: string, staged?: boolean): Promise<import('../shared/ipc-types').GitDiffResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, { cwd, filePath, staged }),
    getDiffSummary: (cwd: string, staged?: boolean): Promise<import('../shared/ipc-types').GitDiffSummaryResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF_SUMMARY, { cwd, staged }),
    stage: (cwd: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STAGE, { cwd, filePath }),
    unstage: (cwd: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_UNSTAGE, { cwd, filePath }),
    stageAll: (cwd: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STAGE_ALL, { cwd }),
    unstageAll: (cwd: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_UNSTAGE_ALL, { cwd }),
    commit: (cwd: string, message: string): Promise<import('../shared/ipc-types').GitCommitResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, { cwd, message }),
    push: (cwd: string, remote?: string, branch?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, { cwd, remote, branch }),
    pull: (cwd: string, remote?: string, branch?: string): Promise<import('../shared/ipc-types').GitPullResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PULL, { cwd, remote, branch }),
    fetch: (cwd: string, remote?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_FETCH, { cwd, remote }),
    branchList: (cwd: string): Promise<import('../shared/ipc-types').GitBranchListResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCH_LIST, { cwd }),
    branchCreate: (cwd: string, name: string, checkout?: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCH_CREATE, { cwd, name, checkout }),
    branchSwitch: (cwd: string, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCH_SWITCH, { cwd, name }),
    stash: (cwd: string, message?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH, { cwd, message }),
    stashPop: (cwd: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_POP, { cwd }),
    stashList: (cwd: string): Promise<import('../shared/ipc-types').GitStashListResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_LIST, { cwd }),
    getRemoteUrl: (cwd: string, remote?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_REMOTE_URL, { cwd, remote }),
    isRepo: (cwd: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_IS_REPO, { cwd }),
  },
  dialog: {
    openFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER),
  },
  update: {
    check: (): Promise<UpdateAvailableInfo | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),

    download: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),

    install: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),

    onAvailable: (callback: (info: UpdateAvailableInfo) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: UpdateAvailableInfo) => callback(info)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_AVAILABLE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_AVAILABLE, handler)
    },

    onNotAvailable: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, handler)
    },

    onProgress: (callback: (progress: UpdateProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: UpdateProgress) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_PROGRESS, handler)
    },

    onDownloaded: (callback: (info: { version: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) => callback(info)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOADED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_DOWNLOADED, handler)
    },

    onError: (callback: (error: UpdateErrorInfo) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: UpdateErrorInfo) => callback(error)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ERROR, handler)
    },
  },
  zoom: {
    get: (): Promise<ZoomInfo> =>
      ipcRenderer.invoke(IPC_CHANNELS.ZOOM_GET),

    set: (factor: number): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ZOOM_SET, { factor }),

    reset: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ZOOM_RESET),
  },
  notification: {
    getSettings: (): Promise<NotificationSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SETTINGS_GET),

    updateSettings: (partial: Partial<NotificationSettings>): Promise<NotificationSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SETTINGS_SET, partial),

    onPlaySound: (callback: (payload: NotificationPayload) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: NotificationPayload) => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_PLAY_SOUND, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_PLAY_SOUND, handler)
    },
  },
  window: {
    minimize: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),

    maximize: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),

    close: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),

    isMaximized: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),

    onMaximizedStateChange: (callback: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
      ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, handler)
    },
  },
  shell: {
    openInVscode: (path: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_IN_VSCODE, { path }),

    openInExplorer: (path: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER, { path }),

    checkVscodeAvailable: (): Promise<{ available: boolean; command: string | null; method: 'cli' | 'uri' | null }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE),
  } satisfies ShellApi
})
