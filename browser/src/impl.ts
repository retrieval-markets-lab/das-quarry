import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { peerIdFromString } from "@libp2p/peer-id";
import { Uint8ArrayList } from "uint8arraylist";
import { decode, encode } from "@ipld/dag-cbor";
import { toPublic, Key } from "./signer.js";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Network } from "./network.js";
import type { CID } from "multiformats";
import { Message, serializeSignedMessage, signMessage } from "./messages.js";
import {
  chainExchangeClient,
  FullBlock,
  decodeBlockHeader,
} from "./chainExchange.js";

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
  subscribeToBlocks: (cb: (blk: FullBlock) => void) => any;
  importKey: (privKey: string) => Key;
  connect: (maddr: string) => Promise<any>;
  pushMessage: (msg: Message) => Promise<CID>;
  waitMessage: (msg: CID) => Promise<any>;
};

type ClientOptions = {
  networkName: string;
};

export function createQuarry(
  network: Network,
  options: ClientOptions
): QuarryClient {
  const keystore: Map<string, Key> = new Map();
  const chainExchange = chainExchangeClient(network);
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
      network.pubsub.addEventListener("message", async (evt) => {
        switch (evt.detail.topic) {
          case topic:
            const header = decodeBlockHeader(evt.detail.data);
            const messages = await chainExchange.getChainMessages(
              header.parents,
              1
            );
            cb({ header, ...messages });
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
      const { value: key } = keystore.values().next();
      msg.from = key.addr;
      const smsg = signMessage(msg, key.priv);
      const enc = serializeSignedMessage(smsg);

      await network.pubsub.publish("/fil/msgs/" + options.networkName, enc);
      return smsg.cid;
    },
    waitMessage: function (msg: CID) {
      return new Promise((resolve, reject) => {
        resolve("TODO");
      });
    },
  };
}
