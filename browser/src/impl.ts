import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { peerIdFromString } from "@libp2p/peer-id";
import { Uint8ArrayList } from "uint8arraylist";
import { decode, encode } from "@ipld/dag-cbor";
import { GossipSub } from "@chainsafe/libp2p-gossipsub";
import { defaultTopicScoreParams } from "@chainsafe/libp2p-gossipsub/score";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Network } from "./network.js";
import type { CID } from "multiformats";
import type { PubSubEvents } from "@libp2p/interface-pubsub";
import {
  Message,
  serializeSignedMessage,
  signMessage,
  estimateMessageGas,
} from "./messages.js";
import { BlockMsg, decodeBlockMsg, BlockHeader } from "./chainExchange.js";
import { toPublic, Key } from "./signer.js";

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

type Unsubscribe = Function;

export type QuarryClient = {
  subscribeToBlocks: (cb: (blk: BlockMsg) => void) => Unsubscribe;
  importKey: (privKey: string) => Key;
  pushMessage: (msg: Message) => Promise<CID>;
  waitMessage: (msg: CID) => Promise<any>;
  getHead: () => Promise<BlockHeader>;
};

type ClientOptions = {
  networkName: string;
  handleHello?: boolean;
  bootstrappers?: string[];
};

export async function createQuarry(
  network: Network,
  options: ClientOptions
): Promise<QuarryClient> {
  // The latest block header.
  let head: BlockHeader | null = null;

  // insecure keystore in memory for development. Do not store real private keys in there!
  const keystore: Map<string, Key> = new Map();
  const msgTopic = "/fil/msgs/" + options.networkName;
  const blkTopic = "/fil/blocks/" + options.networkName;

  // gossip params are setup after Lotus params in order for the node to be treated
  // as similarly as other peers as possible. Need more research into fine tuning these.
  const pubsub = new GossipSub(network, {
    floodPublish: true,
    allowedTopics: [msgTopic, blkTopic],
    scoreParams: {
      topics: {
        [blkTopic]: {
          ...defaultTopicScoreParams,
          // expected 10 blocks/min
          topicWeight: 0.1, // max cap is 50, max mesh penalty is -10, single invalid message is -100
          // 1 tick per second, maxes at 1 after 1 hour
          timeInMeshWeight: 0.00027, // ~1/3600
          timeInMeshQuantum: 1,
          timeInMeshCap: 1,
          // deliveries decay after 1 hour, cap at 100 blocks
          firstMessageDeliveriesWeight: 5, // max value is 500
          firstMessageDeliveriesDecay: 0.998722,
          firstMessageDeliveriesCap: 100, // 100 blocks in an hour
          // invalid messages decay after 1 hour
          invalidMessageDeliveriesWeight: -1000,
          invalidMessageDeliveriesDecay: 0.998722,
        },
        [msgTopic]: {
          ...defaultTopicScoreParams,
          // expected > 1 tx/second
          topicWeight: 0.1, // max cap is 5, single invalid message is -100
          // 1 tick per second, maxes at 1 hour
          timeInMeshWeight: 0.0002778, // ~1/3600
          timeInMeshQuantum: 1,
          timeInMeshCap: 1,
          // deliveries decay after 10min, cap at 100 tx
          firstMessageDeliveriesWeight: 0.5, // max value is 50
          firstMessageDeliveriesDecay: 0.992354,
          firstMessageDeliveriesCap: 100, // 100 messages in 10 minutes
          // invalid messages decay after 1 hour
          invalidMessageDeliveriesWeight: -1000,
          invalidMessageDeliveriesDecay: 0.998722,
        },
      },
      topicScoreCap: 10.0,
      // Can prevent pruning bootstrap nodes when we know them.
      appSpecificScore: () => 0.0,
      appSpecificWeight: 1,
      IPColocationFactorWeight: -100,
      IPColocationFactorThreshold: 5,
      IPColocationFactorWhitelist: new Set(),
      behaviourPenaltyWeight: -10.0,
      behaviourPenaltyThreshold: 6,
      behaviourPenaltyDecay: 0.998722,
      decayInterval: 1000.0,
      decayToZero: 0.1,
      retainScore: 3600 * 6,
    },
    scoreThresholds: {
      gossipThreshold: -500,
      publishThreshold: -1000,
      graylistThreshold: -2500,
      acceptPXThreshold: 1000,
      opportunisticGraftThreshold: 3.5,
    },
    gossipsubIWantFollowupMs: 5 * 1000,
  });
  await pubsub.start();

  pubsub.subscribe(blkTopic);
  pubsub.subscribe(msgTopic);
  pubsub.addEventListener("message", async (evt) => {
    switch (evt.detail.topic) {
      case blkTopic:
        const msg = decodeBlockMsg(evt.detail.data);
        head = msg.header;
        break;
      case msgTopic:
        break;
    }
  });
  pubsub.addEventListener("subscription-change", (evt) => {
    // TODO we could filter out peers in the bootstrappers list who
    // aren't subuscribed to the msgs for whatever reason.
    console.log(evt);
  });

  // kind of unnecessary so far
  if (options.handleHello) {
    network.handle("/fil/hello/1.0.0", async ({ connection, stream }) => {
      const chunks = new Uint8ArrayList();
      for await (const chunk of stream.source) {
        chunks.append(chunk);
      }
      const [_tipSet, _height, ,] = decode<HelloMsg>(chunks.slice());

      const tArrival = performance.now() * 1000;

      stream.sink(
        (function* () {
          const tSent = performance.now() * 1000;
          yield encode([tArrival, tSent]);
        })()
      );
    });
  }

  // dial all the bootstrapper peers
  if (options.bootstrappers) {
    await Promise.all(
      options.bootstrappers.map((addr) => network.dial(multiaddr(addr)))
    );
  }

  // Long running block subscription, returns an easy way to
  // cancel for usage in React effect hooks for example.
  function subscribeToBlocks(cb: (blk: BlockMsg) => any) {
    const listener = (evt: PubSubEvents["message"]) => {
      if (evt.detail.topic === blkTopic) {
        const msg = decodeBlockMsg(evt.detail.data);
        cb(msg);
      }
    };
    pubsub.addEventListener("message", listener);
    return function () {
      pubsub.removeEventListener("message", listener);
    };
  }

  // return the latest block header if we've already seen it or
  // wait for it to show up on pubsub
  async function getHead(): Promise<BlockHeader> {
    if (head) {
      return head;
    }
    return new Promise((resolve) => {
      const listener = (evt: PubSubEvents["message"]) => {
        if (evt.detail.topic === blkTopic) {
          pubsub.removeEventListener("message", listener);
          resolve(decodeBlockMsg(evt.detail.data).header);
        }
      };
      pubsub.addEventListener("message", listener);
    });
  }

  return {
    getHead,
    subscribeToBlocks,
    importKey: function (privKey: string): Key {
      const key = toPublic(privKey);
      keystore.set(key.addr, key);
      return key;
    },
    pushMessage: async function (msg: Message): Promise<CID> {
      const { value: key } = keystore.values().next();
      msg.from = key.addr;
      estimateMessageGas(msg, await getHead());
      const smsg = signMessage(msg, key.priv);
      const enc = serializeSignedMessage(smsg);

      await pubsub.publish(msgTopic, enc);
      return smsg.cid;
    },
    waitMessage: function (cid: CID) {
      return new Promise((resolve, reject) => {
        const listener = (evt: PubSubEvents["message"]) => {
          if (evt.detail.topic === blkTopic) {
            const blk = decodeBlockMsg(evt.detail.data);
            // if the message is contained in the block, it was executed.
            // TODO: fetch execution receipt.
            if (blk.secpkMessages.some((msg) => msg.equals(cid))) {
              pubsub.removeEventListener("message", listener);
              resolve(null);
            }
          }
        };
        pubsub.addEventListener("message", listener);
      });
    },
  };
}
