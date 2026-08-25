// Deploys StockMonsterCollection and registers the full 254-species roster in batches.
// Usage: npx hardhat run scripts/deploy.ts --network <networkName>
import hre from 'hardhat';
import { loadAllSpecies, toRegisterArgs } from '../test/contracts/helpers/loadSpeciesArgs.js';

const REGISTER_BATCH_SIZE = 50;
const IMAGE_BASE_URI = process.env.IMAGE_BASE_URI ?? 'ipfs://REPLACE_WITH_COLLECTION_CID';

async function main() {
  const { ethers } = await hre.network.connect();
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from ${deployer.address}`);

  const factory = await ethers.getContractFactory('StockMonsterCollection');
  const contract = await factory.deploy(deployer.address, IMAGE_BASE_URI);
  await contract.waitForDeployment();
  console.log(`StockMonsterCollection deployed at ${await contract.getAddress()}`);

  const species = loadAllSpecies();
  console.log(`Registering ${species.length} species in batches of ${REGISTER_BATCH_SIZE}...`);
  for (let i = 0; i < species.length; i += REGISTER_BATCH_SIZE) {
    const batch = species.slice(i, i + REGISTER_BATCH_SIZE);
    const tx = await contract.registerSpecies(...toRegisterArgs(batch));
    await tx.wait();
    console.log(`  registered ${i + batch.length}/${species.length}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
