const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BASE = "https://www.stockmonsters.app/nft/meta/";
const COLLECTION = "https://www.stockmonsters.app/nft/collection.json";
const id = (personality, otId) => (BigInt(personality) << 32n) | BigInt(otId);

async function deploy() {
  const [owner, signer, alice, bob, carol] = await ethers.getSigners();
  const C = await ethers.getContractFactory("StockMonsters");
  const nft = await C.deploy(owner.address, signer.address, BASE, COLLECTION);
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "Stock Monsters", version: "1", chainId, verifyingContract: await nft.getAddress() };
  const voucher = (to, tokenId, deadline, by = signer) =>
    by.signTypedData(domain, { Mint: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "deadline", type: "uint256" }] }, { to, tokenId, deadline });
  const swapSig = (by, give, get, nonce, deadline) =>
    by.signTypedData(domain, { Swap: [{ name: "give", type: "uint256" }, { name: "get", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, { give, get, nonce, deadline });
  const later = async (s = 600) => BigInt(await time.latest()) + BigInt(s);
  const mintTo = async (who, tokenId) => nft.connect(who).mint(tokenId, await later(), await voucher(who.address, tokenId, await later()));
  return { nft, owner, signer, alice, bob, carol, voucher, swapSig, later, mintTo };
}

describe("StockMonsters", () => {
  describe("mint", () => {
    it("mints to the caller with a server voucher", async () => {
      const { nft, alice, voucher, later } = await deploy();
      const t = id(0xdeadbeef, 0x1234), d = await later();
      await nft.connect(alice).mint(t, d, await voucher(alice.address, t, d));
      expect(await nft.ownerOf(t)).to.equal(alice.address);
    });

    it("rejects a voucher for someone else", async () => {
      const { nft, alice, bob, voucher, later } = await deploy();
      const t = id(1, 2), d = await later();
      await expect(nft.connect(bob).mint(t, d, await voucher(alice.address, t, d))).to.be.revertedWithCustomError(nft, "BadSignature");
    });

    it("rejects a voucher not signed by the server", async () => {
      const { nft, alice, voucher, later } = await deploy();
      const t = id(1, 2), d = await later();
      await expect(nft.connect(alice).mint(t, d, await voucher(alice.address, t, d, alice))).to.be.revertedWithCustomError(nft, "BadSignature");
    });

    it("rejects an expired voucher", async () => {
      const { nft, alice, voucher, later } = await deploy();
      const t = id(1, 2), d = await later(60);
      const sig = await voucher(alice.address, t, d);
      await time.increase(120);
      await expect(nft.connect(alice).mint(t, d, sig)).to.be.revertedWithCustomError(nft, "Expired");
    });

    it("can't mint the same monster twice", async () => {
      const { nft, alice, voucher, later } = await deploy();
      const t = id(7, 7), d = await later();
      const sig = await voucher(alice.address, t, d);
      await nft.connect(alice).mint(t, d, sig);
      await expect(nft.connect(alice).mint(t, d, sig)).to.be.revertedWithCustomError(nft, "ERC721InvalidSender");
    });

    it("follows a signer rotation", async () => {
      const { nft, owner, alice, carol, voucher, later } = await deploy();
      await nft.connect(owner).setSigner(carol.address);
      const t = id(3, 3), d = await later();
      await expect(nft.connect(alice).mint(t, d, await voucher(alice.address, t, d))).to.be.revertedWithCustomError(nft, "BadSignature");
      await nft.connect(alice).mint(t, d, await voucher(alice.address, t, d, carol));
      expect(await nft.ownerOf(t)).to.equal(alice.address);
    });
  });

  describe("swap", () => {
    async function twoOwners() {
      const f = await deploy();
      const a = id(0xa, 1), b = id(0xb, 2);
      await f.mintTo(f.alice, a);
      await f.mintTo(f.bob, b);
      return { ...f, a, b };
    }

    it("moves both tokens when the partner signed", async () => {
      const { nft, alice, bob, swapSig, later, a, b } = await twoOwners();
      const d = await later();
      const sig = await swapSig(bob, b, a, 0n, d); // bob gives b, gets a
      await expect(nft.connect(alice).swap(a, b, d, sig)).to.emit(nft, "Swapped").withArgs(a, b, alice.address, bob.address);
      expect(await nft.ownerOf(a)).to.equal(bob.address);
      expect(await nft.ownerOf(b)).to.equal(alice.address);
      expect(await nft.swapNonce(bob.address)).to.equal(1n);
    });

    it("can't be replayed", async () => {
      const { nft, alice, bob, swapSig, later, a, b } = await twoOwners();
      const d = await later();
      const sig = await swapSig(bob, b, a, 0n, d);
      await nft.connect(alice).swap(a, b, d, sig);
      // alice now owns b, bob owns a: the same call fails on ownership
      await expect(nft.connect(alice).swap(a, b, d, sig)).to.be.revertedWithCustomError(nft, "NotYourToken");
    });

    it("rejects a signature for a different pair", async () => {
      const { nft, alice, bob, swapSig, later, mintTo, a, b } = await twoOwners();
      const c = id(0xc, 3);
      await mintTo(alice, c);
      const d = await later();
      const sig = await swapSig(bob, b, a, 0n, d); // bob agreed to a, not c
      await expect(nft.connect(alice).swap(c, b, d, sig)).to.be.revertedWithCustomError(nft, "BadSignature");
    });

    it("rejects a caller who doesn't own `give`", async () => {
      const { nft, carol, bob, swapSig, later, a, b } = await twoOwners();
      const d = await later();
      const sig = await swapSig(bob, b, a, 0n, d);
      await expect(nft.connect(carol).swap(a, b, d, sig)).to.be.revertedWithCustomError(nft, "NotYourToken");
    });

    it("rejects after the deadline", async () => {
      const { nft, alice, bob, swapSig, later, a, b } = await twoOwners();
      const d = await later(60);
      const sig = await swapSig(bob, b, a, 0n, d);
      await time.increase(120);
      await expect(nft.connect(alice).swap(a, b, d, sig)).to.be.revertedWithCustomError(nft, "Expired");
    });

    it("cancelSwaps voids outstanding signatures", async () => {
      const { nft, alice, bob, swapSig, later, a, b } = await twoOwners();
      const d = await later();
      const sig = await swapSig(bob, b, a, 0n, d);
      await nft.connect(bob).cancelSwaps();
      await expect(nft.connect(alice).swap(a, b, d, sig)).to.be.revertedWithCustomError(nft, "BadSignature");
    });

    it("a signature dies when the partner's token moves", async () => {
      const { nft, alice, bob, carol, swapSig, later, a, b } = await twoOwners();
      const d = await later();
      const sig = await swapSig(bob, b, a, 0n, d);
      await nft.connect(bob).transferFrom(bob.address, carol.address, b);
      await expect(nft.connect(alice).swap(a, b, d, sig)).to.be.revertedWithCustomError(nft, "BadSignature");
    });
  });

  describe("metadata", () => {
    it("serves tokenURI from the game and contractURI for the collection", async () => {
      const { nft, alice, mintTo } = await deploy();
      const t = id(0xffffffff, 0xffffffff);
      await mintTo(alice, t);
      expect(await nft.tokenURI(t)).to.equal(`${BASE}${t}.json`);
      expect(await nft.contractURI()).to.equal(COLLECTION);
      expect(await nft.supportsInterface("0x49064906")).to.equal(true);
      expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    });

    it("only the owner can change URIs or the signer", async () => {
      const { nft, alice } = await deploy();
      await expect(nft.connect(alice).setURIs("x", "y")).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
      await expect(nft.connect(alice).setSigner(alice.address)).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });
});
