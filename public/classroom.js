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
  let releaseHostLock;

  // Some privacy settings block browser storage. Keep the current tab playable
  // even when its identity or its latest round cannot be saved for later.
  function browserStorage(name) {
    const memory = new Map();
    return {
      getItem(key) {
        if (memory.has(key)) return memory.get(key);
        try { return globalThis[name].getItem(key); } catch { return null; }
      },
      setItem(key, value) {
        try { globalThis[name].setItem(key, value); memory.delete(key); }
        catch { memory.set(key, value); }
      },
    };
  }
  const tabStorage = browserStorage("sessionStorage");
  const profileStorage = browserStorage("localStorage");

  const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
  const fromHex = text => Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
  const randomKey = () => hex(crypto.getRandomValues(new Uint8Array(24)));
  const peerId = id => "bitcoin-replay-" + id;
  const snapshotKey = id => prefix + id + ".snapshot";

  function hostRecord() {
    const previous = JSON.parse(tabStorage.getItem(hostKey) || "null");
    const requested = new URL(location.href).searchParams.get("host");
    if (requested && idFormat.test(requested) && previous?.id !== requested) {
      const saved = profileStorage.getItem(hostKey + "." + requested);
      if (saved) return JSON.parse(saved);
    }
    if (previous) return previous;
    const lastId = profileStorage.getItem(hostKey);
    return lastId ? JSON.parse(profileStorage.getItem(hostKey + "." + lastId)) : null;
  }

  function currentHostId() {
    return hostRecord()?.id || null;
  }

  function saveHostRecord(record) {
    const encoded = JSON.stringify(record);
    profileStorage.setItem(hostKey + "." + record.id, encoded);
    profileStorage.setItem(hostKey, record.id);
    tabStorage.setItem(hostKey, encoded);
  }

  function playerKey(id) {
    const key = prefix + id + ".player";
    const token = tabStorage.getItem(key) || randomKey();
    tabStorage.setItem(key, token);
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
    const record = hostRecord();
    if (record) {
      const privateKey = await crypto.subtle.importKey("jwk", record.jwk, algorithm, false, ["sign"]);
      // Migrate existing session-only hosts without changing their invite URLs.
      saveHostRecord(record);
      return { ...record, privateKey };
    }
    const pair = await crypto.subtle.generateKey(algorithm, true, ["verify", "sign"]);
    const newRecord = {
      id: await keyId(pair.publicKey),
      publicKey: hex(await crypto.subtle.exportKey("raw", pair.publicKey)),
      jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      token: randomKey(),
    };
    saveHostRecord(newRecord);
    return { ...newRecord, privateKey: pair.privateKey };
  }

  function dispose() {
    clearTimeout(reconnectTimer);
    const peer = activePeer;
    activePeer = null;
    if (peer && !peer.destroyed) peer.destroy();
    if (releaseHostLock) {
      releaseHostLock();
      releaseHostLock = null;
    }
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
    const locks = globalThis.navigator?.locks;
    if (!locks) return openHost();
    // Claim the host role before creating the first identity in this browser.
    // The lock also prevents a second tab from presenting a conflicting round.
    return new Promise((resolve, reject) => {
      locks.request(hostKey, { ifAvailable: true }, async lock => {
        if (!lock) throw Error("Your host room is already open in another tab. Use that tab to invite players.");
        const session = await openHost();
        await new Promise(release => {
          releaseHostLock = release;
          resolve(session);
        });
      }).catch(reject);
    });
  }

  async function openHost() {
    const owner = await hostIdentity();
    const joinUrl = address("room", owner.id);
    const archive = await fetch("./history.json", { signal: AbortSignal.timeout(12000) });
    if (!archive.ok) throw Error("The historical archive could not be loaded.");
    const saved = JSON.parse(tabStorage.getItem(snapshotKey(owner.id)) || "null");
    const engine = new BitcoinReplayRoom(await archive.json(), { saved });
    const hostPlayer = playerKey(owner.id);
    function run(path, body, token, isHost, expectedRound) {
      if (expectedRound && expectedRound !== engine.roundId) {
        throw Error("The class started a new round. Please check your position.");
      }
      const state = engine.request(path, body, token, isHost, joinUrl);
      if (path !== "state") tabStorage.setItem(snapshotKey(owner.id), JSON.stringify(engine.save()));
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
          // The historical candles are immutable, so classmates following the
          // replay also only need candles printed since their last update.
          const priceCount = message.priceCount;
          if (message.roundId === state.roundId && Number.isInteger(priceCount) &&
              priceCount > 0 && priceCount <= state.prices.length) {
            state.priceOffset = priceCount;
            state.prices = state.prices.slice(priceCount);
          }
          // The ticket chart can contain hundreds of fills. A cursor verifies
          // which part of the shared book this student has already seen.
          const cursor = message.chartCursor;
          if (cursor && cursor.roundId === state.roundId && Number.isInteger(cursor.index) && cursor.index >= 0) {
            const point = state.ticketHistory[cursor.index];
            if (point && point.second === cursor.second && point.price === cursor.price) {
              state.chartOffset = cursor.index + 1;
              state.ticketHistory = state.ticketHistory.slice(state.chartOffset);
            }
          }
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
    let connection, connecting, roundId, lastChart, lastPrices;
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
      const previous = lastChart;
      const knownPrices = lastPrices;
      const priceCount = knownPrices && knownPrices.id === roundId ? knownPrices.prices.length : 0;
      // The newest quarter-second bucket can still change on a student fill.
      const index = previous ? previous.history.length - 2 : -1;
      const chartCursor = index >= 0 ? { roundId: previous.id, index, ...previous.history[index] } : null;
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
        try { conn.send({ id: requestId, path, body: body || null, roundId: roundId || null, token: player, chartCursor, priceCount }); }
        catch (error) { pending.get(requestId)?.reject(error); pending.delete(requestId); }
      });
      if (state.chartOffset !== undefined) {
        if (!chartCursor || state.roundId !== chartCursor.roundId || state.chartOffset !== index + 1) {
          lastChart = null;
          throw Error("Refreshing the ticket chart. Check your position before trading again.");
        }
        state.ticketHistory = previous.history.slice(0, state.chartOffset).concat(state.ticketHistory);
        delete state.chartOffset;
      }
      if (Array.isArray(state.ticketHistory)) lastChart = { id: state.roundId, history: state.ticketHistory };
      if (state.priceOffset !== undefined) {
        if (!knownPrices || state.roundId !== knownPrices.id || priceCount !== state.priceOffset) {
          lastPrices = null;
          throw Error("Refreshing Bitcoin prices. Check your position before trading again.");
        }
        state.prices = knownPrices.prices.concat(state.prices);
        delete state.priceOffset;
      }
      if (Array.isArray(state.prices)) lastPrices = { id: state.roundId, prices: state.prices };
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
