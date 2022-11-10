# DAS QUARRY

> Retrieval market for blockchain state enabling decentralized light clients.

## Roadmap

Quarry is still in development. Stay tune for our next releases.

## Usage

- Browser client

```ts
import {createLibp2p} from "libp2p";
import {Noise} from "@chainsafe/libp2p-noise";
import {webTransport} from "@libp2p/webtransport";
import {createQuarry, networks, messages} from "das-quarry";

const libp2p = await createLibp2p({
  transports: [webTransport()],
  connectionEncryption: [() => new Noise()],
});
await libp2p.start();
 
const client = await createQuarry(libp2p, {
  network: networks.FilecoinDevNet,
});

const amount = await client.getBalance("t1izccwid4h3svp5sl2xow6jhuc72qmznv6gkbecq");

await client.sendMessage(messages.send({ amount, to: "t3v4c7vddk4dkqz6atlwi5zgsvaunm3ojqozfukd6i3j5wt6rdsz7tuysdxg4vdyez37qk5rj3p5zetxzaoiaa" }));
```

- Nodes

`SOON™️`
