import { expect } from "aegir/chai";
import {
  toStorageBlock,
  signMessage,
  serializeSignedMessage,
} from "../src/messages.js";
import { toPublic } from "../src/signer.js";
import { toHex } from "multiformats/bytes";

describe("messages", () => {
  it("encodes a message", () => {
    const { data, cid } = toStorageBlock({
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
    const msgString = toHex(data);
    expect(msgString).to.equal(
      "8a005501ea0f0ea039b291a0f08fd179e0556a8c3277c0d3550146442b207c3ee557f64bd5dd6f24f417f50665b5182242000c187b4200ea4200ea0640"
    );

    expect(cid.toString()).to.equal(
      "bafy2bzaceax4su4dipbrdsnqivh7i57flcprnmpd5u7jlax26geaze6de2eg4"
    );
  });

  it("signs a message", () => {
    const key = toPublic("8EkrelmXXqGwOqnSzPK19VPNo8X2ibvap2sVcF5AZtg=");
    const smsg = signMessage(
      {
        version: 0,
        to: "t15ihq5ibzwki2b4ep2f46avlkrqzhpqgtga7pdrq",
        from: key.addr,
        nonce: 34,
        value: "12",
        gasLimit: 123,
        gasFeeCap: "234",
        gasPremium: "234",
        method: 6,
        params: "",
      },
      key.priv
    );
    expect(toHex(smsg.signature)).to.equal(
      "efdbb8ac12e6a4fb427378df7ffc1e6d48fa4f4e2d2956f5e85e2c8bcd5b58e4384f7eaf7cfd5aab62b1f88db7c4f84b1451452d563c50b89ec936447a56b13c01"
    );

    expect(toHex(serializeSignedMessage(smsg))).to.equal(
      "828a005501ea0f0ea039b291a0f08fd179e0556a8c3277c0d3550146442b207c3ee557f64bd5dd6f24f417f50665b5182242000c187b4200ea4200ea0640584201efdbb8ac12e6a4fb427378df7ffc1e6d48fa4f4e2d2956f5e85e2c8bcd5b58e4384f7eaf7cfd5aab62b1f88db7c4f84b1451452d563c50b89ec936447a56b13c01"
    );
  });
});
