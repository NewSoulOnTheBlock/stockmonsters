import { defineConfig } from 'hardhat/config';
import hardhatToolboxMochaEthers from '@nomicfoundation/hardhat-toolbox-mocha-ethers';

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    // keep Hardhat's Mocha/Solidity contract tests separate from the plain vitest reference-
    // implementation tests already living in test/*.test.ts
    tests: { mocha: 'test/contracts' },
  },
});
