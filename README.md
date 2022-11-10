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

## Running a local testnet 

These are instructions for running a local Filecoin testnet on Ubuntu with a single miner. 

First install docker and create a folder to take in docker data. 

```bash
sudo apt-get update
sudo apt install docker.io
sudo snap install docker
mkdir ~/docker_data
```

To get a local testnet running, first make sure docker can access at least 8GB of RAM and over 10GB of disk space. 

Then run the following docker image in detached mode: 

```bash
sudo docker run -p 1234:1234 -d -i -t -v ~/docker_data:/data --name lotus-fvm-localnet ghcr.io/jimpick/lotus-fvm-localnet-lite:latest lotus daemon --lotus-make-genesis=devgen.car --genesis-template=localnet.json --bootstrap=false
```

Create the following file locally as `config.toml` : 

```toml

[Libp2p]
  ListenAddresses = ["/ip4/0.0.0.0/tcp/2001/ws", "/ip6/::/tcp/0"]

```

Copy this file into the container and restart the original image. 

```bash
sudo docker cp ./config.toml lotus-fvm-localnet:/home/ubuntu/.lotus-local-net/config.toml
sudo docker restart lotus-fvm-localnet 
```

In conjunction to this; start a miner: 

```bash
sudo docker exec -i -d -t lotus-fvm-localnet lotus-miner run --nosync
```

And you can watch the chain using: 

```bash
sudo docker exec -it lotus-fvm-localnet watch lotus chain list --count=3
```