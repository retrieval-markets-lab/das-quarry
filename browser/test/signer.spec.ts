import { expect } from "aegir/chai";
import { toPublic } from "../src/signer.js";

describe("signer", () => {
  it("derives a private key to a filecoin address", () => {
    const priv_key = "8EkrelmXXqGwOqnSzPK19VPNo8X2ibvap2sVcF5AZtg=";
    expect(toPublic(priv_key).addr).to.equal(
      "t1izccwid4h3svp5sl2xow6jhuc72qmznv6gkbecq"
    );
  });
});
