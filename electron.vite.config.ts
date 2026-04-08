import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    resolve: {
      alias: [
        // Only match exact bare specifier — NOT sub-paths like @mariozechner/jiti/lib/jiti.mjs
        { find: /^@mariozechner\/jiti$/, replacement: resolve(__dirname, 'src/main/jiti-patch.ts') },
      ],
    },
  },
  preload: {},
  renderer: {
    plugins: [tailwindcss()]
  }
})
