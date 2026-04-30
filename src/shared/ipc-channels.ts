/**
 * Shared IPC channel names used by both main and renderer processes.
 * Channel names follow the pattern `namespace:action` for consistency.
 */
export const IPC_CHANNELS = {
  SESSION_CREATE: 'session:create',
  SESSION_PROMPT: 'session:prompt',
  SESSION_EVENTS: 'session:events',
  SESSION_ABORT: 'session:abort',
  SESSION_DISPOSE: 'session:dispose',
  SESSION_DELETE: 'session:delete',
  SESSION_RECONNECT: 'session:reconnect',
  SESSION_LOAD_HISTORY: 'session:load-history',
  SESSION_LOAD_HISTORY_DISK: 'session:load-history-disk',
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_LIST: 'project:list',
  PROJECT_SESSIONS: 'project:sessions',
  WORKSPACE_SET_ACTIVE: 'workspace:setActive',
  WORKSPACE_GET_ACTIVE: 'workspace:getActive',
  SESSION_GET_MODEL: 'session:get-model',
  SESSION_LIST_MODELS: 'session:list-models',
  SESSION_SET_MODEL: 'session:set-model',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',
  GIT_GET_BRANCH: 'git:get-branch',
  ZOOM_GET: 'zoom:get',
  ZOOM_SET: 'zoom:set',
  ZOOM_RESET: 'zoom:reset',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
