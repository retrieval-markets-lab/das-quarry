import type { ConnectionManager } from "@libp2p/interface-connection-manager";
import { encode, decode } from "@ipld/dag-cbor";
import { Uint8ArrayList } from "uint8arraylist";
import { CID } from "multiformats";
import { blake2b256 } from "@multiformats/blake2/blake2b";

export type BlockHeader = {
  miner: Uint8Array;
  ticket: Uint8Array[];
  electionProof: [number, Uint8Array];
  beaconEntries: any[];
  winPoStProof: any[];
  parents: CID[];
  parentsWeight: Uint8Array;
  height: number;
  parentStateRoot: CID;
  parentMessageReceipts: CID;
  messages: CID;
  blsAggregate: Uint8Array;
  timestamp: number;
  blockSig: Uint8Array;
  forkSignaling: number;
  parentBaseFee: Uint8Array;
};

export type BlockMsg = {
  header: BlockHeader;
  blsMessages: CID[];
  secpkMessages: CID[];
  cid: CID;
};

export type FullBlock = {
  header: BlockHeader;
  blsMessages: any[];
  secpkMessages: SecpkMessages;
};

export function decodeBlockMsg(bytes: Uint8Array): BlockMsg {
  const [header, blsMessages, secpkMessages] =
    decode<[any[], CID[], CID[]]>(bytes);
  // We have to re-encode the header unfortunately, can't find a way to
  // progressively decode the message without building a custom tokeniser.
  const headerBytes = encode(header);
  const hash = blake2b256.digest(headerBytes);
  // @ts-ignore-next-line: thinks it's a promise but nah.
  const cid = CID.create(1, 0x71, hash);

  return {
    header: {
      miner: header[0],
      ticket: header[1],
      electionProof: header[2],
      beaconEntries: header[3],
      winPoStProof: header[4],
      parents: header[5],
      parentsWeight: header[6],
      height: header[7],
      parentStateRoot: header[8],
      parentMessageReceipts: header[9],
      messages: header[10],
      blsAggregate: header[11],
      timestamp: header[12],
      blockSig: header[13],
      forkSignaling: header[14],
      parentBaseFee: header[15],
    },
    blsMessages,
    secpkMessages,
    cid,
  };
}

// First 2 are Bls messages we don't support quite yet
type CompactedMessages = [any[], number[][], SecpkMessages, number[][]];

type BlkTipSet = [BlockHeader[], CompactedMessages];

// [[message CID, message data], signature]
type SecpkMessages = [[CID, any], Uint8Array][];

type Messages = {
  secpkMessages: SecpkMessages;
  blsMessages: any[];
};

enum Status {
  Ok = 0,
  // We could not fetch all blocks requested (but at least we returned
  // the `Head` requested). Not considered an error.
  Partial = 101,
  // Errors
  NotFound = 201,
  GoAway = 202,
  InternalError = 203,
  BadRequest = 204,
}

type Response = [Status, string, BlkTipSet[]];

function decodeMessages(data: Uint8Array): Messages {
  const [status, error, chain] = decode<Response>(data);
  if (error || status !== Status.Ok) {
    throw new Error(error ?? Status[status]);
  }
  if (chain[0]) {
    return {
      secpkMessages: chain[0][1][2],
      blsMessages: chain[0][1][0],
    };
  }
  return {
    secpkMessages: [],
    blsMessages: [],
  };
}

type ChainExchange = {
  getChainMessages: (head: CID[], length: number) => Promise<Messages>;
};

type Host = {
  connectionManager: ConnectionManager;
};

function encodeMessageRequest(tipset: CID[], length: number): Uint8Array {
  return encode([tipset, length, 2]);
}

export function chainExchangeClient(host: Host): ChainExchange {
  return {
    getChainMessages: async function (
      tipset: CID[],
      length: number
    ): Promise<Messages> {
      const conn = host.connectionManager.getConnections().pop();
      if (!conn) {
        throw new Error("no open connections");
      }
      const stream = await conn.newStream("/fil/chain/xchg/0.0.1");
      await stream.sink(
        (function* () {
          yield encodeMessageRequest(tipset, length);
        })()
      );

      const chunks = new Uint8ArrayList();
      for await (const chunk of stream.source) {
        chunks.append(chunk);
      }

      return decodeMessages(chunks.subarray());
    },
  };
}
