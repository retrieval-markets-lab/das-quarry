import type { PubSub } from "@libp2p/interface-pubsub";
import type { ConnectionManager } from "@libp2p/interface-connection-manager";
import type { Registrar } from "@libp2p/interface-registrar";
import type { Connection } from "@libp2p/interface-connection";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";

export type Network = {
  pubsub: PubSub;
  connectionManager: ConnectionManager;
  dial: (peer: PeerId | Multiaddr, options?: any) => Promise<Connection>;
  handle: Registrar["handle"];
};
