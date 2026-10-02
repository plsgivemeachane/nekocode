// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

describe('renderer browser storage', () => {
  it('uses jsdom storage consistently through global and window access', () => {
    const browserWindow = (globalThis as typeof globalThis & {
      jsdom: { window: Window }
    }).jsdom.window
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      expect(globalThis[name]).toBe(browserWindow[name])
      globalThis[name].setItem('storage-regression', 'value')
      expect(window[name].getItem('storage-regression')).toBe('value')
      globalThis[name].removeItem('storage-regression')
    }
  })
})
