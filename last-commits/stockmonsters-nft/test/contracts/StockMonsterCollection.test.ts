import { expect } from 'chai';
import { network } from 'hardhat';
import { loadAllSpecies, toRegisterArgs, type RawSpecies } from './helpers/loadSpeciesArgs.js';

const BALL = { REGULAR: 0, GREAT: 1, ULTRA: 2 } as const;
const STATUS = { NONE: 0, SLEEP: 1, FREEZE: 2, PARALYZE: 3, POISON: 4, BURN: 5 } as const;

/** registerSpecies is designed to be called in batches - the full 254-species roster in one
 * call blows the block gas limit (confirmed by trying it), which is exactly why it's owner-only
 * and batchable rather than done once in the constructor. */
const REGISTER_BATCH_SIZE = 50;

async function deployWithSpecies(list: RawSpecies[]) {
  const { ethers } = await network.connect();
  const [owner, trainer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory('StockMonsterCollection');
  const contract = await factory.deploy(owner.address, 'ipfs://test-cid');
  for (let i = 0; i < list.length; i += REGISTER_BATCH_SIZE) {
    await contract.registerSpecies(...toRegisterArgs(list.slice(i, i + REGISTER_BATCH_SIZE)));
  }
  return { ethers, owner, trainer, contract };
}

const applion = loadAllSpecies().find((s) => s.ticker === 'AAPL')!; // real catchRate 45, two types
const easyCatch: RawSpecies = { ...applion, catchRate: 255 };

describe('StockMonsterCollection', () => {
  describe('ball pricing', () => {
    it('exposes the exact prices from the spec', async () => {
      const { contract } = await deployWithSpecies([applion]);
      expect(await contract.ballPrice(BALL.REGULAR)).to.equal(2n * 10n ** 15n); // 0.002 ETH
      expect(await contract.ballPrice(BALL.GREAT)).to.equal(6n * 10n ** 15n); // 0.006 ETH
      expect(await contract.ballPrice(BALL.ULTRA)).to.equal(10n ** 16n); // 0.01 ETH
    });

    it('rejects a throwBall call with the wrong payment', async () => {
      const { contract, trainer } = await deployWithSpecies([applion]);
      await expect(
        contract.connect(trainer).throwBall(applion.dexId, 10, 40, 40, STATUS.NONE, BALL.REGULAR, {
          value: 1, // wrong
        }),
      ).to.be.revertedWith('wrong payment for this ball');
    });
  });

  describe('computeA (catch-rate math)', () => {
    it('matches the off-chain reference for a known scenario', async () => {
      const { contract } = await deployWithSpecies([applion]);
      // a = floor(floor(3*40-2*40)*45*10/(3*40*10)) * (statusNum/statusDen)
      //   = floor(floor(40)*45*10/1200) * 1 = floor(18000/1200) = 15
      const a = await contract.computeA(applion.dexId, 40, 40, STATUS.NONE, BALL.REGULAR);
      expect(a).to.equal(15n);
    });

    it('reaches the guaranteed-catch threshold for an easy species at low HP with the best ball+status', async () => {
      const { contract } = await deployWithSpecies([easyCatch]);
      const a = await contract.computeA(easyCatch.dexId, 100, 1, STATUS.FREEZE, BALL.ULTRA);
      expect(a).to.be.greaterThanOrEqual(255n);
    });

    it('reverts for an unregistered species', async () => {
      const { contract } = await deployWithSpecies([applion]);
      await expect(contract.computeA(60000, 40, 40, STATUS.NONE, BALL.REGULAR)).to.be.revertedWith(
        'unknown species',
      );
    });

    it('reverts if currentHp exceeds maxHp', async () => {
      const { contract } = await deployWithSpecies([applion]);
      await expect(contract.computeA(applion.dexId, 10, 11, STATUS.NONE, BALL.REGULAR)).to.be.revertedWith(
        'bad hp',
      );
    });
  });

  describe('throwBall - deterministic outcomes', () => {
    it('a guaranteed-catch scenario always mints, regardless of randomness', async () => {
      const { contract, trainer } = await deployWithSpecies([easyCatch]);
      const tx = await contract
        .connect(trainer)
        .throwBall(easyCatch.dexId, 10, 100, 1, STATUS.FREEZE, BALL.ULTRA, { value: await contract.ballPrice(BALL.ULTRA) });
      const receipt = await tx.wait();
      const caughtEvent = receipt!.logs.find((l) => contract.interface.parseLog(l)?.name === 'StockmonsterCaught');
      expect(caughtEvent).to.not.be.undefined;
      expect(await contract.totalMinted()).to.equal(1n);
      expect(await contract.ownerOf(1)).to.equal(trainer.address);
    });

    it('a hopeless scenario (a=0) always breaks free and mints nothing', async () => {
      const hopeless: RawSpecies = { ...applion, catchRate: 1 };
      const { contract, trainer } = await deployWithSpecies([hopeless]);
      const a = await contract.computeA(hopeless.dexId, 999, 999, STATUS.NONE, BALL.REGULAR);
      expect(a).to.equal(0n);

      const tx = await contract
        .connect(trainer)
        .throwBall(hopeless.dexId, 10, 999, 999, STATUS.NONE, BALL.REGULAR, { value: await contract.ballPrice(BALL.REGULAR) });
      const receipt = await tx.wait();
      const brokeFree = receipt!.logs.find((l) => contract.interface.parseLog(l)?.name === 'BrokeFree');
      expect(brokeFree).to.not.be.undefined;
      expect(await contract.totalMinted()).to.equal(0n);
    });

    it('generates traits with the right dexId/level and stats within plausible bounds', async () => {
      const { contract, trainer } = await deployWithSpecies([easyCatch]);
      await contract
        .connect(trainer)
        .throwBall(easyCatch.dexId, 25, 100, 1, STATUS.FREEZE, BALL.ULTRA, { value: await contract.ballPrice(BALL.ULTRA) });
      const traits = await contract.traitsOf(1);
      expect(traits.dexId).to.equal(BigInt(easyCatch.dexId));
      expect(traits.level).to.equal(25n);
      // HP formula: floor((2*base+iv)*level/100) + level + 10, iv in [0,31]
      const minHp = Math.floor((2 * easyCatch.baseStats.hp + 0) * 25 / 100) + 25 + 10;
      const maxHp = Math.floor((2 * easyCatch.baseStats.hp + 31) * 25 / 100) + 25 + 10;
      expect(Number(traits.hp)).to.be.within(minHp, maxHp);
    });
  });

  describe('shiny cap - exactly one per species', () => {
    it('never mints a second shiny for the same species even across many guaranteed-catch mints', async () => {
      const { contract, trainer } = await deployWithSpecies([easyCatch]);
      let shinyCount = 0;
      const price = await contract.ballPrice(BALL.ULTRA);
      for (let i = 0; i < 40; i++) {
        await contract
          .connect(trainer)
          .throwBall(easyCatch.dexId, 10, 100, 1, STATUS.FREEZE, BALL.ULTRA, { value: price });
        const t = await contract.traitsOf(i + 1);
        if (t.shiny) shinyCount++;
      }
      expect(shinyCount).to.be.lessThanOrEqual(1);
      expect(await contract.shinyClaimed(easyCatch.dexId)).to.equal(shinyCount === 1);
    });
  });

  describe('global supply cap', () => {
    it('refuses to mint once GLOBAL_SUPPLY_CAP is reached', async function () {
      this.timeout(10 * 60_000);
      const cap = await (await deployWithSpecies([])).contract.GLOBAL_SUPPLY_CAP();
      const { contract, trainer } = await deployWithSpecies([easyCatch]);
      const price = await contract.ballPrice(BALL.ULTRA);

      for (let i = 0n; i < cap; i++) {
        await contract
          .connect(trainer)
          .throwBall(easyCatch.dexId, 10, 100, 1, STATUS.FREEZE, BALL.ULTRA, { value: price });
      }
      expect(await contract.totalMinted()).to.equal(cap);

      await expect(
        contract
          .connect(trainer)
          .throwBall(easyCatch.dexId, 10, 100, 1, STATUS.FREEZE, BALL.ULTRA, { value: price }),
      ).to.be.revertedWith('supply exhausted');
    });
  });

  describe('tokenURI', () => {
    it('returns a valid base64 data URI containing all expected traits', async () => {
      const { contract, trainer } = await deployWithSpecies([easyCatch]);
      await contract
        .connect(trainer)
        .throwBall(easyCatch.dexId, 15, 100, 1, STATUS.FREEZE, BALL.ULTRA, { value: await contract.ballPrice(BALL.ULTRA) });
      const uri = await contract.tokenURI(1);
      expect(uri.startsWith('data:application/json;base64,')).to.equal(true);
      const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf-8'));
      const traitTypes = json.attributes.map((a: { trait_type: string }) => a.trait_type);
      for (const expected of ['Species', 'Ticker', 'Type 1', 'Type 2', 'Level', 'HP', 'Attack', 'Defense', 'Special Attack', 'Special Defense', 'Speed', 'Shiny']) {
        expect(traitTypes).to.include(expected);
      }
    });
  });

  describe('registering the full real roster', () => {
    it('accepts all 254 species from data/species.json in one batch call', async () => {
      const all = loadAllSpecies();
      const { contract } = await deployWithSpecies(all);
      const last = all[all.length - 1];
      const stored = await contract.species(last.dexId);
      expect(stored.registered).to.equal(true);
      expect(stored.name).to.equal(last.name);
    });
  });
});
