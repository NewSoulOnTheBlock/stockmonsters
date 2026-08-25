// Standalone vitest config: the game's vite.config.ts imports the RPG-JS
// server (and through it canvasengine, which needs `window`), so tests must
// not load it. The battle core under test is plain TypeScript anyway.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // chat-filter/names are pure logic too — they must not import @rpgjs/*.
    // profile.ts is listed for the same reason AND as a boundary guard: it is
    // bundled into the browser, so it must import nothing Node-only. If that
    // ever regresses, this suite fails to load rather than the client breaking
    // at runtime.
    include: [
      'src/battle/**/*.spec.ts',
      'src/modules/main/chat-filter.spec.ts',
      'src/modules/main/profile.spec.ts',
      // drives a real battle through a fake player to check the wire traffic
      // the battle overlay depends on
      'src/modules/main/battle.spec.ts',
      'src/modules/main/chat.spec.ts',
    ],
    environment: 'node',
  },
})
