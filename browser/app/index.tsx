import * as React from "react";
import * as ReactDOM from "react-dom";
import { useState, useEffect } from "react";
import { createLibp2p, Libp2p } from "libp2p";
import * as filters from "@libp2p/websockets/filters";
import { webSockets } from "@libp2p/websockets";
import { yamux } from "@chainsafe/libp2p-yamux";
import { noise } from "@chainsafe/libp2p-noise";
import {
  createQuarry,
  ChainInfo,
  Key,
  QuarryClient,
  messages,
} from "das-quarry";
import Spinner from "./Spinner.js";

const ADDR_KEY = "/maddr/default";
const NETNAME_KEY = "/netname/default";
const PRIV_KEY = "/pkeyimport/default";
const TO_KEY = "/toaddr/default";
const AMOUNT_KEY = "/amount/default";

function App() {
  const [quarry, setQuarry] = useState<QuarryClient | null>(null);
  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [maddr, setMaddr] = useState(localStorage.getItem(ADDR_KEY) ?? "");
  const [netname, setNetname] = useState(
    localStorage.getItem(NETNAME_KEY) ?? ""
  );
  const [loading, setLoading] = useState(false);

  async function connectPeer() {
    setLoading(true);

    localStorage.setItem(NETNAME_KEY, netname);
    localStorage.setItem(ADDR_KEY, maddr);

    const host = await createLibp2p({
      transports: [webSockets({ filter: filters.all })],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
    });
    await host.start();

    console.log(host.peerId.toString());

    const q = await createQuarry(host, {
      networkName: netname,
      bootstrappers: [maddr],
      handleHello: true,
    });

    q.subscribeToBlocks((blk) => {
      setInfo({ latestTipset: [blk.cid], height: blk.header.height });
      if (loading) {
        setLoading(false);
      }
    });

    setQuarry(q);
  }

  const [rawprivkey, setRawprivkey] = useState(
    localStorage.getItem(PRIV_KEY) ?? ""
  );
  const [key, setKey] = useState<Key | null>(null);
  function importKey() {
    localStorage.setItem(PRIV_KEY, rawprivkey);
    setKey(quarry.importKey(rawprivkey));
  }

  const [to, setTo] = useState(localStorage.getItem(TO_KEY) ?? "");
  const [amount, setAmount] = useState(localStorage.getItem(AMOUNT_KEY) ?? "");
  async function sendMessage() {
    localStorage.setItem(TO_KEY, to);
    localStorage.setItem(AMOUNT_KEY, amount);
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
          ) ?? "Not connected to network"}
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
