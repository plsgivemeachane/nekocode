// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('jsdom storage lifecycle after Node storage shadowing fix', () => {
  it('keeps localStorage and sessionStorage isolated while sharing the real jsdom backing', () => {
    const browserWindow = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window
    expect(globalThis.localStorage).toBe(browserWindow.localStorage)
    expect(globalThis.sessionStorage).toBe(browserWindow.sessionStorage)

    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('same-key', 'local')
    sessionStorage.setItem('same-key', 'session')

    expect(localStorage.getItem('same-key')).toBe('local')
    expect(sessionStorage.getItem('same-key')).toBe('session')
    expect(localStorage.length).toBe(1)
    expect(sessionStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe('same-key')
    expect(sessionStorage.key(0)).toBe('same-key')
  })

  it('supports remove, clear, and length through both global and window access', () => {
    const browserWindow = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window
    browserWindow.localStorage.clear()
    globalThis.localStorage.setItem('one', '1')
    globalThis.localStorage.setItem('two', '2')
    expect(browserWindow.localStorage.length).toBe(2)

    browserWindow.localStorage.removeItem('one')
    expect(globalThis.localStorage.getItem('one')).toBeNull()
    expect(globalThis.localStorage.length).toBe(1)
    globalThis.localStorage.clear()
    expect(browserWindow.localStorage.length).toBe(0)
    expect(browserWindow.localStorage.key(0)).toBeNull()
  })
})
