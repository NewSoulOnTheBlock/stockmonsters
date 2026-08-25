import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // test/contracts/** belongs to Hardhat's mocha runner (npx hardhat test), not vitest.
    include: ['test/*.test.ts'],
  },
});
