import { encode } from "@ipld/dag-cbor";
import { addressToBytes } from "./signer.js";
import { BN } from "bn.js";
import { Uint8ArrayList } from "uint8arraylist";
import { CID } from "multiformats";
import { blake2b256 } from "@multiformats/blake2/blake2b";

// A Filecoin message for sending to miners and include in blocks.
// It is encoded as a CBOR array.
export type Message = {
  version: number;
  to: string;
  from: string;
  nonce: number;
  value: string;
  gasLimit: number;
  gasFeeCap: string;
  gasPremium: string;
  method: number;
  params: string;
};

export function send({ amount, to }: { amount: string; to: string }): Message {
  return {
    version: 0,
    to,
    from: "",
    nonce: 1,
    value: amount,
    gasLimit: 0,
    gasFeeCap: "3000",
    gasPremium: "0",
    method: 0,
    params: "",
  };
}

// encode a Filecoin message into a CBOR array for signature.
export function encodeMessage(msg: Message) {
  return encode([
    0,
    addressToBytes(msg.to),
    addressToBytes(msg.from),
    msg.nonce,
    serializeBigNum(msg.value),
    msg.gasLimit,
    serializeBigNum(msg.gasFeeCap),
    serializeBigNum(msg.gasPremium),
    msg.method,
    new Uint8Array(),
  ]);
}

// Encode Filecoin amount strings for inclusing in a message.
export function serializeBigNum(num: string): Uint8Array {
  const bn = new BN(num, 10);
  // @ts-ignore
  const bnBuf = bn.toArrayLike(Uint8Array, "be", bn.byteLength());
  const bytes = new Uint8ArrayList();
  bytes.append(new Uint8Array([0]));
  bytes.append(bnBuf);
  return bytes.slice();
}

export function toStorageBlock(msg: Message): { cid: CID; data: Uint8Array } {
  const data = encodeMessage(msg);
  const hash = blake2b256.digest(data);
  // @ts-ignore
  const cid = CID.create(1, 0x71, hash);
  return {
    cid,
    data,
  };
}
