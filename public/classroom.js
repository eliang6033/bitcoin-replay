// GitHub Pages rooms. The presenter's tab owns the clock, market and private state.
(() => {
  "use strict";

  const prefix = "bitcoin-replay.v1.";
  const hostKey = prefix + "host";
  const idFormat = /^[a-f0-9]{24}$/;
  const secretFormat = /^[a-f0-9]{48}$/;
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const signing = { name: "ECDSA", hash: "SHA-256" };
  const connectError = "Could not reach the host. Keep the host tab open and try again. If your network blocks peer connections, try another network.";
  let activePeer;
  let reconnectTimer;

  const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
  const fromHex = text => Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
  const randomKey = () => hex(crypto.getRandomValues(new Uint8Array(24)));
  const peerId = id => "bitcoin-replay-" + id;
  const snapshotKey = id => prefix + id + ".snapshot";

  function currentHostId() {
    return JSON.parse(sessionStorage.getItem(hostKey) || "null")?.id || null;
  }

  function playerKey(id) {
    const key = prefix + id + ".player";
    const token = sessionStorage.getItem(key) || randomKey();
    sessionStorage.setItem(key, token);
    return token;
  }

  function address(role, id) {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set(role, id);
    return url.toString();
  }

  // A signed challenge ties a public room link to the original presenter. A
  // different peer claiming an offline room's signaling ID cannot collect team keys.
  async function keyId(publicKey) {
    const bytes = await crypto.subtle.exportKey("raw", publicKey);
    return hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 24);
  }

  async function hostIdentity() {
    const existing = sessionStorage.getItem(hostKey);
    if (existing) {
      const record = JSON.parse(existing);
      const privateKey = await crypto.subtle.importKey("jwk", record.jwk, algorithm, false, ["sign"]);
      return { ...record, privateKey };
    }
    const pair = await crypto.subtle.generateKey(algorithm, true, ["verify", "sign"]);
    const record = {
      id: await keyId(pair.publicKey),
      publicKey: hex(await crypto.subtle.exportKey("raw", pair.publicKey)),
      jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      token: randomKey(),
    };
    sessionStorage.setItem(hostKey, JSON.stringify(record));
    return { ...record, privateKey: pair.privateKey };
  }

  function dispose() {
    clearTimeout(reconnectTimer);
    const peer = activePeer;
    activePeer = null;
    if (peer && !peer.destroyed) peer.destroy();
  }

  function openPeer(id, token) {
    dispose();
    const options = { secure: true, debug: 0 };
    if (token) options.token = token;
    const peer = id ? new Peer(peerId(id), options) : new Peer(options);
    activePeer = peer;
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("The room service did not respond. Try again.")), 15000);
      peer.once("open", () => { clearTimeout(timeout); resolve(peer); });
      peer.once("error", error => {
        clearTimeout(timeout);
        reject(Error(error.type === "unavailable-id" ? "This host room is already open. Return to its tab, or wait a moment after closing it." : "Could not connect to the room service. Try again."));
      });
    });
    // A signaling outage need not tear down already-open WebRTC connections.
    const reconnect = () => {
      clearTimeout(reconnectTimer);
      if (peer !== activePeer || peer.destroyed) return;
      if (!peer.disconnected) return;
      reconnectTimer = setTimeout(() => {
        if (peer === activePeer && !peer.destroyed && peer.disconnected) {
          try { peer.reconnect(); } catch { reconnect(); }
        }
      }, 2000);
    };
    peer.on("disconnected", reconnect);
    peer.on("error", reconnect);
    return { peer, ready };
  }

  async function create() {
    const owner = await hostIdentity();
    const joinUrl = address("room", owner.id);
    const archive = await fetch("./history.json", { signal: AbortSignal.timeout(12000) });
    if (!archive.ok) throw Error("The historical archive could not be loaded.");
    const saved = JSON.parse(sessionStorage.getItem(snapshotKey(owner.id)) || "null");
    const engine = new BitcoinReplayRoom(await archive.json(), { saved });
    const hostPlayer = playerKey(owner.id);
    function run(path, body, token, isHost, expectedRound) {
      if (expectedRound && expectedRound !== engine.request("state", null, token, isHost, joinUrl).roundId) {
        throw Error("The class started a new round. Please check your position.");
      }
      const state = engine.request(path, body, token, isHost, joinUrl);
      if (path !== "state") sessionStorage.setItem(snapshotKey(owner.id), JSON.stringify(engine.save()));
      return state;
    }
    const { peer, ready } = openPeer(owner.id, owner.token);
    peer.on("connection", conn => {
      if (conn.label !== "bitcoin-replay-v1") { conn.close(); return; }
      let player = null;
      let challengeSeen = false;
      conn.on("data", async message => {
        if (!message || typeof message !== "object" || !conn.open) return;
        try {
          if (!challengeSeen && message.kind === "hello" && secretFormat.test(message.nonce)) {
            challengeSeen = true;
            const proof = await crypto.subtle.sign(signing, owner.privateKey, fromHex(message.nonce));
            if (conn.open) conn.send({ kind: "proof", publicKey: owner.publicKey, signature: hex(proof) });
            return;
          }
          if (!challengeSeen || !secretFormat.test(message.token) || !secretFormat.test(message.id)) return;
          if (player && player !== message.token) { conn.close(); return; }
          player = message.token;
          if (!["state", "join", "trade"].includes(message.path)) throw Error("Students can join and trade only.");
          if (message.path !== "state" && !message.roundId) throw Error("Refresh the room before placing an order.");
          const body = message.path === "trade" ? { ...message.body, orderId: message.id } : message.body;
          const state = run(message.path, body, player, false, message.path === "state" ? null : message.roundId);
          conn.send({ id: message.id, state });
        } catch (error) {
          if (conn.open && secretFormat.test(message.id)) conn.send({ id: message.id, error: error.message });
        }
      });
      conn.on("error", () => conn.close());
    });
    try { await ready; } catch (error) { dispose(); throw error; }
    history.replaceState(null, "", address("host", owner.id));
    return {
      id: owner.id, joinUrl,
      async request(path, body) {
        return run(path, path === "trade" ? { ...body, orderId: randomKey() } : body, hostPlayer, true);
      },
    };
  }

  async function join(id) {
    if (!idFormat.test(id)) throw Error("The room link is incomplete. Ask your host for a new link.");
    const player = playerKey(id);
    const { peer, ready } = openPeer();
    let connection, connecting, roundId;
    const pending = new Map();

    function disconnect(conn) {
      if (connection === conn) connection = null;
      for (const [id, request] of pending) {
        if (request.conn === conn) {
          pending.delete(id);
          request.reject(Error("Connection interrupted. Check your balance when the host reconnects."));
        }
      }
    }

    function connect() {
      if (connection?.open) return Promise.resolve(connection);
      if (connecting) return connecting;
      connecting = new Promise((resolve, reject) => {
        if (!peer.open || peer.destroyed) { reject(Error(connectError)); return; }
        const conn = peer.connect(peerId(id), { label: "bitcoin-replay-v1", reliable: true, serialization: "binary" });
        if (!conn) { reject(Error(connectError)); return; }
        const challenge = randomKey();
        let authenticated = false;
        function fail() {
          clearTimeout(timer);
          disconnect(conn);
          reject(Error(connectError));
        }
        const timer = setTimeout(() => { fail(); conn.close(); }, 17000);
        conn.on("open", () => conn.send({ kind: "hello", nonce: challenge }));
        conn.on("data", async message => {
          if (!message || typeof message !== "object") return;
          if (!authenticated && message.kind === "proof") {
            try {
              if (!/^[a-f0-9]{130}$/.test(message.publicKey) || !/^[a-f0-9]{128}$/.test(message.signature)) throw Error();
              const publicKey = await crypto.subtle.importKey("raw", fromHex(message.publicKey), algorithm, true, ["verify"]);
              if (await keyId(publicKey) !== id || !(await crypto.subtle.verify(signing, publicKey, fromHex(message.signature), fromHex(challenge)))) throw Error();
              if (!conn.open) { fail(); return; }
              authenticated = true;
              clearTimeout(timer);
              connection = conn;
              resolve(conn);
            } catch { fail(); conn.close(); }
            return;
          }
          const request = pending.get(message.id);
          if (authenticated && request?.conn === conn) {
            pending.delete(message.id);
            if (message.error) request.reject(Error(message.error));
            else request.resolve(message.state);
          }
        });
        conn.on("close", fail);
        conn.on("error", () => { fail(); conn.close(); });
      }).finally(() => { connecting = null; });
      return connecting;
    }

    async function request(path, body) {
      // Never queue an old order across a disconnect or retry an ambiguous fill.
      if (path !== "state" && !connection?.open) throw Error("Reconnect and check your position before trading.");
      const conn = await connect();
      const requestId = randomKey();
      const state = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(Error("No reply from the host. Check your position before trying again."));
          disconnect(conn);
          conn.close();
        }, 9000);
        pending.set(requestId, {
          conn,
          resolve: value => { clearTimeout(timeout); resolve(value); },
          reject: error => { clearTimeout(timeout); reject(error); },
        });
        try { conn.send({ id: requestId, path, body: body || null, roundId: roundId || null, token: player }); }
        catch (error) { pending.get(requestId)?.reject(error); pending.delete(requestId); }
      });
      roundId = state.roundId;
      return state;
    }
    try { await ready; await request("state"); }
    catch (error) { dispose(); throw error; }
    return { id, joinUrl: address("room", id), request };
  }

  globalThis.BitcoinClassroom = { create, join, dispose, currentHostId };
  addEventListener("pagehide", event => { if (!event.persisted) dispose(); });
})();
