import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { peerIdFromString } from "@libp2p/peer-id";
import { Uint8ArrayList } from "uint8arraylist";
import { decode, encode } from "@ipld/dag-cbor";
import { GossipSub } from "@chainsafe/libp2p-gossipsub";
import { defaultTopicScoreParams } from "@chainsafe/libp2p-gossipsub/score";
import { Cachestore } from "cache-blockstore";
import { GraphSync } from "@dcdn/graphsync";
import { blake2b256 } from "@multiformats/blake2/blake2b";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Network } from "./network.js";
import type { CID } from "multiformats";
import type { PubSubEvents } from "@libp2p/interface-pubsub";
import {
  Message,
  MessageReceipt,
  buildCid,
  serializeSignedMessage,
  signMessage,
  estimateMessageGas,
} from "./messages.js";
import { BlockMsg, decodeBlockMsg, BlockHeader } from "./chainExchange.js";
import { toPublic, Key } from "./signer.js";
import { AMT } from "./amt.js";

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

type NonceTracker = { [key: string]: number };

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
  const blocks = new Cachestore("/quarry/blocks");
  await blocks.open();

  const exchange = new GraphSync(network, blocks);
  exchange.start();

  exchange.hashers[blake2b256.code] = blake2b256;

  // TODO: select multiple indeces without fetching the whole HAMT
  async function fetchReceipts(
    root: CID,
    peer: PeerId,
    idx: number[]
  ): Promise<MessageReceipt[]> {
    // Select every node up to depth 10
    const selector = {
      R: {
        l: {
          depth: 10,
        },
        ":>": {
          a: {
            ">": {
              "@": {},
            },
          },
        },
      },
    };
    const req = exchange.request(root, selector);
    req.open(peer, { chainsync: {} });
    // loas the blocks in the store
    await req.drain();

    const amt = await AMT.loadAdt0<[number, Uint8Array, number]>(root, blocks);

    const receipts: MessageReceipt[] = [];
    for (const i of idx) {
      const v = await amt.get(BigInt(i));
      if (v) {
        receipts.push({
          exitCode: v[0],
          return: v[1],
          gasUsed: v[2],
        });
      }
    }
    return receipts;
  }

  // The latest block header.
  let head: BlockHeader | null = null;

  const nonceTracker: NonceTracker = {};

  function getNextNonce(addr: string): number {
    if (!nonceTracker[addr]) {
      nonceTracker[addr] = 0;
    }
    return nonceTracker[addr]++;
  }

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
    mcacheLength: 10,
    mcacheGossip: 10,
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
    ).catch((err) => console.error("failed to dial bootstrap peers", err));
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

  function waitNextHead(): Promise<BlockHeader> {
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

  // return the latest block header if we've already seen it or
  // wait for it to show up on pubsub
  async function getHead(): Promise<BlockHeader> {
    if (head) {
      return head;
    }
    return waitNextHead();
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
      if (msg.nonce === 0) {
        msg.nonce = getNextNonce(key.addr);
      }
      estimateMessageGas(msg, await getHead());
      const smsg = signMessage(msg, key.priv);
      const enc = serializeSignedMessage(smsg);
      // re hash the whole thing
      const cid = buildCid(enc);

      await pubsub.publish(msgTopic, enc);
      return cid;
    },
    waitMessage: function (cid: CID): Promise<MessageReceipt> {
      return new Promise((resolve, reject) => {
        const listener = async (evt: PubSubEvents["message"]) => {
          if (evt.detail.topic === blkTopic) {
            const blk = decodeBlockMsg(evt.detail.data);
            // if the message is contained in the block, it was executed.
            const idx = blk.secpkMessages.findIndex((msg) => msg.equals(cid));
            if (idx > -1) {
              console.log("block contains our message");
              pubsub.removeEventListener("message", listener);
              // wait for next head to get receipts
              const nextHead = await waitNextHead();
              console.log("received next head");
              const peer = (await network.peerStore.all()).pop();
              if (!peer) {
                throw new Error("no connected peers");
              }

              const receipt = await fetchReceipts(
                nextHead.parentMessageReceipts,
                peer.id,
                [idx]
              );
              resolve(receipt[0]);
            }
          }
        };
        pubsub.addEventListener("message", listener);
      });
    },
  };
}
