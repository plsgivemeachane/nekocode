import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/renderer/src/hooks/**/*.ts', 'src/renderer/src/components/ChatInput.tsx'],
      exclude: [
        'node_modules/**',
        'src/tests/**',
        '**/*.d.ts',
        'src/main/index.ts',
        'src/preload/**',
        'src/shared/ipc-types.ts',
      ],
    },
  },
})
