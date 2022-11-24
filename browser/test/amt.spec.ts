import { expect } from "aegir/chai";
import { BN } from "bn.js";
import { CID } from "multiformats";
import { AMT } from "../src/amt.js";
import { Buffer } from "buffer";

type CompactLaneState = [Uint8Array, number];

interface Blockstore {
  get(cid: CID): Promise<Uint8Array>;
  setBase64(cid: string, data: string): void;
}

function createBlockstore(): Blockstore {
  const blocks = new Map<string, string>();
  return {
    get: async (cid: CID) => {
      const encoded = blocks.get(cid.toString());
      if (!encoded) {
        throw new Error("block not found " + cid.toString());
      }
      return Buffer.from(encoded, "base64");
    },
    setBase64: (cid: string, data: string) => {
      blocks.set(cid, data);
    },
  };
}

// Tests with Payment channel actor state
describe("amt", () => {
  it("empty array", async () => {
    const root = CID.parse(
      "bafy2bzacedijw74yui7otvo63nfl3hdq2vdzuy7wx2tnptwed6zml4vvz7wee"
    );
    const blocks = createBlockstore();
    blocks.setBase64(root.toString(), "hAMAAINBAICA");

    const amt = await AMT.load(root, blocks);

    expect(amt.count.toString()).to.equal("0");
    expect(amt.height.toString()).to.equal("0");
    expect(amt.bitWidth).to.equal(3);
  });

  it("multiple lanes", async () => {
    const root = CID.parse(
      "bafy2bzaceccdakspqn73bjkqn654hpqocsacflzw52hreo7jedte3j2mxu3im"
    );
    const blocks = createBlockstore();
    blocks.setBase64(
      root.toString(),
      "hAMABYNBH4CFgkIAAQGCQgACAoJCAAMDgkIABASCQgAFBQ=="
    );
    const amt = await AMT.load<CompactLaneState>(root, blocks);

    expect(amt.count.toString()).to.equal("5");
    expect(amt.height.toString()).to.equal("0");
    expect(amt.bitWidth).to.equal(3);

    let i = 0;
    for await (const value of amt) {
      // check redeemed amount
      const redeemed = new BN(value[0]);
      expect(redeemed.toNumber()).to.equal(i + 1);
      // check nonces
      expect(value[1]).to.equal(i + 1);
      i++;
    }
    expect(i).to.equal(5);
  });

  // spaced out lane are quite inneficient and we should be trying to avoid them, for optimal performance
  it("spaced out lanes", async () => {
    const root = CID.parse(
      "bafy2bzacea4rp27v7vojwdthbwjud2nr6z7qcnxja632xowm72eueeqxzj2zw"
    );

    const blocks = createBlockstore();
    blocks.setBase64(
      root.toString(),
      "hAMBCINBB4PYKlgnAAFxoOQCIKJLdF8DHeyDxb+y0L4BFWlkl474SwgJUi/MkskiiTou2CpYJwABcaDkAiDA+HOvs/Jn9qsvxwFxtP8TDwA5kiTS973/V0HsugiRGdgqWCcAAXGg5AIgzBTn4DVpy2DHBN9wbA3GRlRl7xFBC/YTYJWq26aaGfOA"
    );
    blocks.setBase64(
      "bafy2bzacedgbjz7agvu4wyghatpxa3anyzdfizppcfaqx5qtmck2vw5gtim7g",
      "g0EQgIGCQgAICA=="
    );
    blocks.setBase64(
      "bafy2bzacedapq45pwpzgp5vlf7dqc4nu74jq6abzsisnf55575lud3f2bcirs",
      "g0EggIGCQgAHBw=="
    );
    blocks.setBase64(
      "bafy2bzacecrew5c7amo6za6fx6znbpqbcvuwjf4o7bfqqcksf7gjfsjcre5c4",
      "g0E/gIaCQgABAYJCAAICgkIAAwOCQgAEBIJCAAUFgkIABgY="
    );
    const amt = await AMT.load<CompactLaneState>(root, blocks);

    expect(amt.count.toString()).to.equal("8");
    expect(amt.height.toString()).to.equal("1");
    expect(amt.bitWidth).to.equal(3);

    const lanes = [0, 1, 2, 3, 4, 5, 13, 20];

    let i = 0;
    for await (const [idx, v] of amt.entries()) {
      expect(idx.toString()).to.equal(lanes[i].toString());

      // check redeemed amount
      const redeemed = new BN(v[0]);
      expect(redeemed.toNumber()).to.equal(i + 1);
      // check nonces
      expect(v[1]).to.equal(i + 1);

      i++;
    }
    expect(i).to.equal(8);
  });

  it("one lane", async () => {
    const root = CID.parse(
      "bafy2bzacecgrc3fdxb227cvq4gppwctyypuw3j2upj2u2xvhpc3mhyfa7ao6u"
    );

    const blocks = createBlockstore();
    blocks.setBase64(root.toString(), "hAMAAYNBEICBgkMABfAB");
    const amt = await AMT.load<CompactLaneState>(root, blocks);

    const lanes = [4n];

    let i = 0;
    let value;
    for await (const [idx, v] of amt.entries()) {
      expect(idx).to.equal(lanes[i]);
      value = v;
      i++;
    }
    expect(i).to.equal(1);

    const result = await amt.get(4n);
    expect(result).to.deep.equal(value);
  });
});
