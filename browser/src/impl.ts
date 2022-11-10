import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { peerIdFromString } from "@libp2p/peer-id";
import { Uint8ArrayList } from "uint8arraylist";
import { decode, encode } from "@ipld/dag-cbor";
import { toPublic, Key } from "./signer.js";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Network } from "./network.js";
import type { CID } from "multiformats";
import { Message, toStorageBlock } from "./messages.js";

export function getPeerInfo(addrStr: string): {
  id: PeerId;
  multiaddrs: Multiaddr[];
} {
  const ma = multiaddr(addrStr);
  const parts = addrStr.split("/");
  const idx = parts.indexOf("p2p") + 1;
  if (idx === 0) {
    throw new Error("Multiaddr does not contain p2p peer ID");
  }
  return {
    id: peerIdFromString(parts[idx]),
    multiaddrs: [ma],
  };
}

type HelloMsg = [CID[], number, number, CID];

export type ChainInfo = {
  latestTipset: CID[];
  height: number;
};

export type QuarryClient = {
  onPeerConnected: (cb: (addr: Multiaddr) => void) => any;
  onChainInfo: (cb: (info: ChainInfo) => void) => any;
  subscribeToBlocks: (cb: (blk: any) => void) => any;
  importKey: (privKey: string) => Key;
  connect: (maddr: string) => Promise<any>;
  pushMessage: (msg: Message) => Promise<CID>;
};

type ClientOptions = {
  networkName: string;
};

export function createQuarry(
  network: Network,
  options: ClientOptions
): QuarryClient {
  const keystore: Map<string, Key> = new Map();
  return {
    onPeerConnected: function (cb) {
      network.connectionManager.addEventListener("peer:connect", (conn) =>
        cb(conn.detail.remoteAddr)
      );
    },
    onChainInfo: function (cb) {
      network.handle("/fil/hello/1.0.0", async ({ connection, stream }) => {
        const chunks = new Uint8ArrayList();
        for await (const chunk of stream.source) {
          chunks.append(chunk);
        }
        const [tipSet, height, ,] = decode<HelloMsg>(chunks.slice());
        cb({ latestTipset: tipSet, height });
        const tArrival = performance.now() * 1000;

        stream.sink(
          (function* () {
            const tSent = performance.now() * 1000;
            yield encode([tArrival, tSent]);
          })()
        );
      });
    },
    subscribeToBlocks: function (cb) {
      const topic = "/fil/blocks/" + options.networkName;
      network.pubsub.subscribe(topic);
      network.pubsub.addEventListener("message", (evt) => {
        switch (evt.detail.topic) {
          case topic:
            const blk = decode(evt.detail.data);
            cb(blk);
            break;
        }
      });
    },
    importKey: function (privKey: string): Key {
      const key = toPublic(privKey);
      keystore.set(key.addr, key);
      return key;
    },
    connect: function (maddr: string) {
      return network.dial(multiaddr(maddr));
    },
    pushMessage: async function (msg: Message) {
      const { value: addr } = keystore.keys().next();
      msg.from = addr;
      const { cid } = toStorageBlock(msg);
      return cid;
    },
  };
}
