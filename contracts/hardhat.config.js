require("@nomicfoundation/hardhat-toolbox");

// Secrets come from your own shell, never from source control or chat:
//   $env:DEPLOYER_PRIVATE_KEY = "0x..."   (PowerShell)  then  npm run deploy
const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 500 }, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { chainId: 31337 },
    mainnet: {
      url: MAINNET_RPC_URL,
      chainId: 1,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || "" },
};
