import type { ConnectionManager } from "@libp2p/interface-connection-manager";
import type { Registrar } from "@libp2p/interface-registrar";
import type { Connection } from "@libp2p/interface-connection";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";
import type { PeerStore } from "@libp2p/interface-peer-store";

export type Network = {
  peerId: PeerId;
  peerStore: PeerStore;
  connectionManager: ConnectionManager;
  registrar: Registrar;
  dial: (peer: PeerId | Multiaddr, options?: any) => Promise<Connection>;
  handle: Registrar["handle"];
};
