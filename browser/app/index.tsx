import * as React from "react";
import * as ReactDOM from "react-dom";
import { useState, useEffect } from "react";
import { createLibp2p, Libp2p } from "libp2p";
import * as filters from "@libp2p/websockets/filters";
import { webSockets } from "@libp2p/websockets";
import { yamux } from "@chainsafe/libp2p-yamux";
import { noise } from "@chainsafe/libp2p-noise";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import {
  createQuarry,
  ChainInfo,
  Key,
  QuarryClient,
  messages,
} from "das-quarry";
import Spinner from "./Spinner.js";

function App() {
  const [quarry, setQuarry] = useState<QuarryClient | null>(null);
  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [maddr, setMaddr] = useState("");
  const [netname, setNetname] = useState("");
  const [loading, setLoading] = useState(false);

  async function connectPeer() {
    setLoading(true);
    const host = await createLibp2p({
      transports: [webSockets({ filter: filters.all })],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      pubsub: gossipsub(),
    });
    await host.start();

    const q = createQuarry(host, { networkName: netname });

    q.onChainInfo(setInfo);
    q.subscribeToBlocks((blk) => {
      console.log(blk);
    });

    await q.connect(maddr);
    setLoading(false);
  }

  const [rawprivkey, setRawprivkey] = useState("");
  const [key, setKey] = useState<Key | null>(null);
  function importKey() {
    setKey(quarry.importKey(rawprivkey));
  }

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  async function sendMessage() {
    const msgCid = await quarry?.pushMessage(messages.send({ amount, to }));
  }

  return (
    <div className="app">
      <h1>DASQUARRY</h1>

      <h3>Network</h3>
      <input
        id="maddr"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="multi address"
        className="ipt"
        value={maddr}
        onChange={(e) => setMaddr(e.target.value)}
      />

      <input
        id="netname"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="network name"
        className="ipt"
        value={netname}
        onChange={(e) => setNetname(e.target.value)}
      />

      <button
        className="btn"
        onClick={connectPeer}
        disabled={!maddr || !netname}
      >
        connect
      </button>

      <h3>Address</h3>
      <input
        id="privkey"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="private key"
        className="ipt"
        value={rawprivkey}
        onChange={(e) => setRawprivkey(e.target.value)}
      />

      <button className="btn" onClick={importKey} disabled={!rawprivkey}>
        import
      </button>

      <h3>Messages</h3>
      <input
        id="to"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="Recipient address"
        className="ipt"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <input
        id="amount"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="Filecoin amount"
        className="ipt"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button className="btn" onClick={sendMessage} disabled={!to}>
        Publish
      </button>

      {key && <p>{key.addr}</p>}

      <h3>Tipset</h3>

      {loading ? (
        <Spinner />
      ) : (
        <pre>
          {info?.latestTipset.reduce(
            (cid, acc) => cid.toString() + " " + acc,
            ""
          ) ?? "Pending"}
        </pre>
      )}
    </div>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root")
);
