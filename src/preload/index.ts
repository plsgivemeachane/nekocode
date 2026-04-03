import { contextBridge } from 'electron'

// Stub IPC channels — will be wired in T02
contextBridge.exposeInMainWorld('nekocode', {
  version: '0.1.0'
})
