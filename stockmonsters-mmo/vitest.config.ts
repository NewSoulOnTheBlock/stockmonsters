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
      // direct messages: proximity, blocks and the wallet-keyed rate limit,
      // driven through fake players the same way chat.spec.ts is
      'src/modules/main/dm.spec.ts',
      // friend requests, presence, and the acceptance gate that lets a DM
      // travel across the world — against the session-only store, so it needs
      // no database (test/friends.test.mjs covers the SQL one)
      'src/modules/main/friends.spec.ts',
      // what a player is owed for playing, including the ordering trap where
      // a reward is earned before the client has said which wallet they are
      'src/modules/main/earnings.spec.ts',
      'src/modules/main/trainer.spec.ts',
      'src/modules/main/quests.spec.ts',
      // a duel decided from a committed seed: the same seed must always give
      // the same fight, or the commit-reveal proves nothing
      'src/battle/duel.spec.ts',
      // the client hand-encodes its calldata; this checks it against viem,
      // where getting an offset wrong fails somewhere else entirely
      'src/duel-ui.spec.ts',
      // the marketplace's hand-encoded calldata. fillOrder takes a struct of
      // eleven value types, which is STATIC and encodes inline — encode it as
      // dynamic and the fill fails with BAD_SIGNATURE, pointing at the wrong
      // file entirely
      'src/market-source-chain.spec.ts',
      'src/gift.spec.ts',
    ],
    environment: 'node',
  },
})
