// Test setup — runs before each test file
// Add jsdom globals or mock extensions here as needed

// Import jest-dom matchers for DOM assertions (toBeInTheDocument, etc.)
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock scrollIntoView since jsdom does not implement it
// Only applies when running in jsdom environment
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
}

// Node 26 exposes its own Web Storage globals, which can shadow jsdom's
// storage when Vitest installs browser globals. Use the browser environment's
// storage for renderer tests, including when Node's localStorage is undefined.
// Vitest aliases global window to globalThis; jsdom.window is the real DOM window.
const browserWindow = (globalThis as typeof globalThis & {
  jsdom?: { window: Window }
}).jsdom?.window
if (browserWindow) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: browserWindow[name],
    })
  }
}
