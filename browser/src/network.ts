import type { PubSub } from "@libp2p/interface-pubsub";
import type {
  Dialer,
  ConnectionManager,
} from "@libp2p/interface-connection-manager";
import type { Registrar } from "@libp2p/interface-registrar";

export type Network = Dialer &
  Registrar & {
    pubsub: PubSub;
    connectionManager: ConnectionManager;
  };
