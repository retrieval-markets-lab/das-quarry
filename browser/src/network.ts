import type { ConnectionManager } from "@libp2p/interface-connection-manager";
import type { Registrar } from "@libp2p/interface-registrar";
import type { Connection, Stream } from "@libp2p/interface-connection";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";
import type { PeerStore } from "@libp2p/interface-peer-store";

export type Network = Registrar & {
  peerId: PeerId;
  peerStore: PeerStore;
  connectionManager: ConnectionManager;
  registrar: Registrar;
  dial: (peer: PeerId | Multiaddr, options?: any) => Promise<Connection>;
  dialProtocol: (
    peer: PeerId | Multiaddr,
    protocols: string | string[],
    options?: any
  ) => Promise<Stream>;
};
