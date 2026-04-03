import type { NekoCodeIPC } from '../../shared/ipc-types'

declare global {
  interface Window {
    nekocode: NekoCodeIPC
  }
}
