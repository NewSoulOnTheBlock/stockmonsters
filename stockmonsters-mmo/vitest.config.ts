// Standalone vitest config: the game's vite.config.ts imports the RPG-JS
// server (and through it canvasengine, which needs `window`), so tests must
// not load it. The battle core under test is plain TypeScript anyway.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/battle/**/*.spec.ts'],
    environment: 'node',
  },
})
