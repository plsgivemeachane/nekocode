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

// Mock ResizeObserver since jsdom does not implement it
// Required by Radix UI components (Tooltip, ScrollArea, etc.)
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver
}

// Mock IntersectionObserver since jsdom does not implement it
// Required by some Radix UI components for scroll detection
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    root: Element | null = null
    rootMargin: string = ''
    thresholds: ReadonlyArray<number> = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  } as unknown as typeof window.IntersectionObserver
}
