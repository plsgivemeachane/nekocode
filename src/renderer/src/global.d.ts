import type { NekoCodeIPC } from '../../shared/ipc-types'

declare global {
  interface Window {
    nekocode: NekoCodeIPC
  }

  // electron-vite define() injects this as a string literal
  const __APP_VERSION__: string
}
