// Deploys StockMonsters. Run it yourself; the key never leaves your shell.
//
//   PowerShell:
//     $env:DEPLOYER_PRIVATE_KEY = "0x..."          # your deployer wallet (pays gas)
//     $env:NFT_SIGNER = "0x..."                    # from: bun run tools/nft-setup.ts signer
//     $env:MAINNET_RPC_URL = "https://..."         # optional, defaults to a public RPC
//     npm run deploy                               # add -- --dry to only print the plan
//
// Owner = the deployer unless NFT_OWNER is set (e.g. a Safe). The owner can
// rotate the voucher key and change the metadata URLs; it can't touch tokens.
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const signerAddr = process.env.NFT_SIGNER;
  if (!signerAddr || !ethers.isAddress(signerAddr)) throw new Error("Set NFT_SIGNER to the voucher key address (bun run tools/nft-setup.ts signer).");
  const publicUrl = (process.env.PUBLIC_URL || "https://www.stockmonsters.app").replace(/\/+$/, "");
  const base = `${publicUrl}/nft/meta/`;
  const collection = `${publicUrl}/nft/collection.json`;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer: set DEPLOYER_PRIVATE_KEY in this shell.");
  const owner = process.env.NFT_OWNER || deployer.address;
  const { chainId } = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  const Factory = await ethers.getContractFactory("StockMonsters");
  const deployTx = await Factory.getDeployTransaction(owner, signerAddr, base, collection);
  const gas = await ethers.provider.estimateGas({ ...deployTx, from: deployer.address });
  const fee = await ethers.provider.getFeeData();
  const cost = gas * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n);

  console.log(`network      ${network.name} (chain ${chainId})`);
  console.log(`deployer     ${deployer.address}  ${ethers.formatEther(balance)} ETH`);
  console.log(`owner        ${owner}`);
  console.log(`voucher key  ${signerAddr}`);
  console.log(`tokenURI     ${base}<id>.json`);
  console.log(`contractURI  ${collection}`);
  console.log(`gas          ${gas}  (up to ~${ethers.formatEther(cost)} ETH at current fees)`);
  if (process.argv.includes("--dry") || process.env.DRY === "1") return console.log("\ndry run: nothing sent");
  if (balance < cost) throw new Error("Deployer doesn't have enough ETH for the deploy.");

  const nft = await Factory.deploy(owner, signerAddr, base, collection);
  console.log(`\ntx           ${nft.deploymentTransaction().hash}`);
  await nft.waitForDeployment();
  const address = await nft.getAddress();
  console.log(`StockMonsters ${address}`);
  console.log(`\nNext:\n  cd ../netplay-server && bun run tools/nft-setup.ts config ${address} --chain ${chainId}`);
  console.log(`  verify: npx hardhat verify --network ${network.name} ${address} ${owner} ${signerAddr} "${base}" "${collection}"`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
