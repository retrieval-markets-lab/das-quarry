import { expect } from "aegir/chai";
import { encodeMessage } from "../src/messages.js";
import { toHex } from "multiformats/bytes";

describe("messages", () => {
  it("encodes a message", () => {
    const msg = encodeMessage({
      version: 0,
      to: "t15ihq5ibzwki2b4ep2f46avlkrqzhpqgtga7pdrq",
      from: "t1izccwid4h3svp5sl2xow6jhuc72qmznv6gkbecq",
      nonce: 34,
      value: "12",
      gasLimit: 123,
      gasFeeCap: "234",
      gasPremium: "234",
      method: 6,
      params: "",
    });
    const msgString = toHex(msg);
    expect(msgString).to.equal(
      "8a005501ea0f0ea039b291a0f08fd179e0556a8c3277c0d3550146442b207c3ee557f64bd5dd6f24f417f50665b5182242000c187b4200ea4200ea0640"
    );
  });
});
