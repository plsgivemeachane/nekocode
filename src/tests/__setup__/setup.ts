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
