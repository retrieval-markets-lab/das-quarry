import elliptic from "elliptic";
import { base64pad } from "multiformats/bases/base64";
import { base32 } from "multiformats/bases/base32";
import { equals } from "multiformats/bytes";
import { Uint8ArrayList } from "uint8arraylist";
import {
  blake2b32,
  blake2b160,
  blake2b256,
} from "@multiformats/blake2/blake2b";
import { Buffer } from "buffer";
import { BN } from "bn.js";
import { encode } from "@ipld/dag-cbor";

/* Why implement all that stuff from scratch?
 * Those big filecoin JS libraries come with a lot of heavy dependencies...
 * This library seeks to be as minimal as possible.
 * */

const ec = new elliptic.ec("secp256k1");

export type Key = {
  priv: Uint8Array;
  addr: string;
};

export function toPublic(key: string): Key {
  // the codec needs an M prefix for some reason
  const buf = base64pad.decode("M" + key);
  const point = ec.keyFromPrivate(buf).getPublic();

  const uncompPubkey = new Uint8Array(65);
  const pubkey = point.encode(undefined, false);
  for (let i = 0; i < uncompPubkey.length; ++i) uncompPubkey[i] = pubkey[i];

  // Typescript thinks the interface should return a promise but the impl doesn't
  // so we ignore it in order to avoid making this an async function.
  const addrHash = blake2b160.encode(uncompPubkey);
  return {
    priv: buf,
    // @ts-ignore-next-line
    addr: newAddress(AddressType.SECP256K1, addrHash, Network.TEST),
  };
}

export function sign(key: Uint8Array, msg: Uint8Array) {
  // Typescript thinks this is a promise so if we have to ignore things below.
  const hash = blake2b256.encode(msg);

  const output = new Uint8Array(65);
  // @ts-ignore
  const sig = ec.sign(hash, Buffer.from(key), { canonical: true });
  // Uint8Array is valid here but types expect any[].
  // @ts-ignore
  output.set(sig.r.toArrayLike(Uint8Array, "be", 32), 0);
  // @ts-ignore
  output.set(sig.s.toArrayLike(Uint8Array, "be", 32), 32);
  if (sig.recoveryParam === null) {
    throw new Error("no recovery param");
  }
  output.set([sig.recoveryParam], 64);
  return output;
}

enum AddressType {
  ID = 0,
  SECP256K1 = 1,
  ACTOR = 2,
  BLS = 3,
}

enum Network {
  MAIN = "f",
  TEST = "t",
}

function calcChecksum(data: Uint8Array): Uint8Array {
  // @ts-ignore
  return blake2b32.encode(data);
}

// Create a new address. Only Secp256k1 is supported for now.
function newAddress(
  type: AddressType,
  pubkey: Uint8Array,
  net: Network
): string {
  const prefix = net + type;
  const protocolByte = new Uint8Array([type]);
  const checksumPayload = new Uint8ArrayList();
  checksumPayload.append(protocolByte);
  checksumPayload.append(pubkey);
  const checksum = calcChecksum(checksumPayload.slice());
  const bytes = new Uint8ArrayList();
  bytes.append(pubkey);
  bytes.append(checksum);
  return prefix + base32.encode(bytes.slice()).slice(1);
}

// Encode an address string to bytes for inclusion in a message.
export function addressToBytes(addr: string) {
  const addrBytes = base32.decode(addr.slice(2));
  const payload = addrBytes.slice(0, -4);
  if (!equals(calcChecksum(payload), addrBytes.slice(-4))) {
    throw new Error("address checksum doesn't match");
  }
  const bytes = new Uint8ArrayList();
  bytes.append(new Uint8Array([AddressType.SECP256K1]));
  bytes.append(payload);
  return bytes.slice();
}

// Encode Filecoin amount strings for inclusing in a message.
export function serializeBigNum(num: string): Uint8Array {
  const bn = new BN(num, 10);
  // @ts-ignore
  const bnBuf = bn.toArrayLike(Uint8Array, "be", bn.byteLength);
  const bytes = new Uint8ArrayList();
  bytes.append(new Uint8Array([0]));
  bytes.append(bnBuf);
  return bytes.slice();
}

// A Filecoin message for sending to miners and include in blocks.
// It is encoded as a CBOR array.
type Message = {
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
