import { encode } from "@ipld/dag-cbor";
import { addressToBytes, sign } from "./signer.js";
import { BN } from "bn.js";
import { Uint8ArrayList } from "uint8arraylist";
import { CID } from "multiformats";
import { blake2b256 } from "@multiformats/blake2/blake2b";
import type { BlockHeader } from "./chainExchange.js";

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

export function send({
  amount,
  to,
  nonce,
}: {
  amount: string;
  to: string;
  nonce?: number;
}): Message {
  return {
    version: 0,
    to,
    from: "",
    nonce: nonce ?? 0,
    value: amount,
    gasLimit: 0,
    gasFeeCap: "",
    gasPremium: "",
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

// decode bigint from a big-endian byte slice.
export function decodeBigNum(data: Uint8Array): bigint {
  const buf = data.buffer;
  let bits = 8n;
  if (ArrayBuffer.isView(buf)) {
    bits = BigInt(data.BYTES_PER_ELEMENT * 8);
  }

  let ret = 0n;
  for (const i of data.values()) {
    const bi = BigInt(i);
    ret = (ret << bits) + bi;
  }
  return ret;
}

export function buildCid(data: Uint8Array): CID {
  const hash = blake2b256.digest(data);
  // @ts-ignore
  return CID.create(1, 0x71, hash);
}

export function toStorageBlock(msg: Message): { cid: CID; data: Uint8Array } {
  const data = encodeMessage(msg);
  return {
    cid: buildCid(data),
    data,
  };
}

export type SignedMessage = {
  msg: Message;
  signature: Uint8Array;
  bytes: Uint8Array;
  cid: CID;
};

export function signMessage(msg: Message, privKey: Uint8Array): SignedMessage {
  const { cid, data } = toStorageBlock(msg);
  return {
    signature: sign(privKey, cid.bytes),
    msg,
    bytes: data,
    cid,
  };
}

export function serializeSignedMessage(smsg: SignedMessage): Uint8Array {
  const sigUl = new Uint8ArrayList();
  // secp256k1 sign type is a 0 byte
  sigUl.append(new Uint8Array([1]));
  sigUl.append(smsg.signature);

  const msg = smsg.msg;
  return encode([
    [
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
    ],
    sigUl.slice(),
  ]);
}

const BlockGasLimit = 10_000_000_000;
const BlockGasTarget = BlockGasLimit / 2;
const MinGasPremium = 100e3;

export function estimateMessageGas(msg: Message, head: BlockHeader): Message {
  if (!msg.gasLimit) {
    // Gas Limit is usually estimated by running the transaction through the state manager's VM
    // need to think of a strategy for saving gas here we default to the block gas target which is
    // way higher but should work for most transactions.
    msg.gasLimit = BlockGasTarget / 10;
  }
  if (!msg.gasPremium) {
    msg.gasPremium = 1.5 * MinGasPremium + "";
  }
  if (!msg.gasFeeCap) {
    const baseFee = decodeBigNum(head.parentBaseFee);
    const increaseFactor = Math.pow(1 + 1 / 8, 20);

    const feeInFuture = baseFee * BigInt(Math.round(increaseFactor * (1 << 8)));
    const feeCap = feeInFuture / BigInt(1 << 8) + BigInt(msg.gasPremium);
    msg.gasFeeCap = feeCap + "";
  }
  return msg;
}

export type MessageReceipt = {
  exitCode: number;
  return: Uint8Array;
  gasUsed: number;
};
