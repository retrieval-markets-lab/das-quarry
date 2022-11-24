import { expect } from "aegir/chai";
import { toPublic, addressToBytes } from "../src/signer.js";
import { toHex } from "multiformats/bytes";

describe("signer", () => {
  it("derives a private key to a filecoin address", () => {
    const priv_key = "8EkrelmXXqGwOqnSzPK19VPNo8X2ibvap2sVcF5AZtg=";
    expect(toPublic(priv_key).addr).to.equal(
      "t1izccwid4h3svp5sl2xow6jhuc72qmznv6gkbecq"
    );
  });

  it("decodes an address string", () => {
    const addrBytes = addressToBytes(
      "t15ihq5ibzwki2b4ep2f46avlkrqzhpqgtga7pdrq"
    );
    expect(toHex(addrBytes)).to.equal(
      "01ea0f0ea039b291a0f08fd179e0556a8c3277c0d3"
    );
  });
});
