// Exercise the transport protocol in independent browser contexts. The event bus
// replaces WebRTC only; role checks, signatures, session storage and the engine are real.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const source = name => readFileSync(path.join(__dirname, "..", "public", name), "utf8");

test("invite, host proof, independent seats, host-only controls and reconnect after reload", async () => {
  const network = new Map();
  let milliseconds = Date.UTC(2021, 0, 1);
  class RoomClock extends Date {
    static now() { return milliseconds; }
  }
  let peerNumber = 0;
  class Channel extends EventEmitter {
    send(value) { queueMicrotask(() => { if (this.open) this.other.emit("data", structuredClone(value)); }); }
    close() {
      if (!this.open) return;
      this.open = this.other.open = false;
      this.emit("close"); this.other.emit("close");
    }
  }
  class Peer extends EventEmitter {
    constructor(id) {
      super();
      this.id = typeof id === "string" ? id : "student-" + ++peerNumber;
      this.channels = [];
      network.set(this.id, this);
      this.open = true;
      queueMicrotask(() => this.emit("open"));
    }
    connect(id, { label }) {
      const target = network.get(id);
      const a = new Channel(), b = new Channel();
      a.other = b; b.other = a;
      a.label = b.label = label;
      a.open = b.open = true;
      this.channels.push(a); target.channels.push(b);
      target.emit("connection", b);
      queueMicrotask(() => { a.emit("open"); b.emit("open"); });
      return a;
    }
    destroy() {
      this.destroyed = true; this.open = false;
      for (const channel of this.channels) channel.close();
      network.delete(this.id);
    }
  }
  const local = new Map();
  const held = new Set();
  const locks = {
    async request(key, options, callback) {
      assert.equal(options.ifAvailable, true);
      if (held.has(key)) return callback(null);
      held.add(key);
      try { return await callback({ name: key }); }
      finally { held.delete(key); }
    },
  };
  function tab(session = new Map(), url = "https://example.github.io/bitcoin-replay/") {
    const storage = values => ({ getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) });
    const context = vm.createContext({
      crypto: webcrypto, Peer, URL, AbortSignal, Date: RoomClock, setTimeout, clearTimeout, addEventListener() {},
      fetch: async () => ({ ok: true, json: async () => JSON.parse(source("history.json")) }),
      location: { href: url }, history: { replaceState() {} }, navigator: { locks },
      localStorage: storage(local), sessionStorage: storage(session),
    });
    vm.runInContext(source("room-engine.js"), context);
    vm.runInContext(source("classroom.js"), context);
    return context.BitcoinClassroom;
  }
  const presenting = tab(), playing = tab(), watching = tab();
  let host = await presenting.create();
  const originalInvite = host.joinUrl;
  await assert.rejects(tab().create(), /already open in another tab/);
  const student = await playing.join(host.id);
  const spectator = await watching.join(host.id);
  assert.equal(new URL(host.joinUrl).searchParams.get("room"), host.id);
  assert.equal((await student.request("state")).host, false);
  assert.equal((await host.request("state")).host, true);
  await assert.rejects(student.request("host", { action: "start" }), /Students can join and trade only/);
  await student.request("join", { name: "First table" });
  assert.equal((await spectator.request("state")).me, null);
  const opening = await host.request("host", { action: "start" });
  assert.equal(opening.npcCount, 20);
  assert.equal(opening.players, 1);
  milliseconds += 10000;
  const unattended = await student.request("state");
  assert.ok(unattended.npcTrades > 0);
  assert.deepEqual((await spectator.request("state")).ticketHistory, unattended.ticketHistory);
  const traded = await student.request("trade", { action: "buy", side: "down" });
  assert.equal(traded.me.down, 1);
  assert.ok(traded.quotes.buyUp < unattended.quotes.buyUp);
  assert.equal((await spectator.request("state")).ticketHistory.at(-1).price, traded.quotes.buyUp);
  assert.equal(traded.reveal, null);
  milliseconds += 5500;
  const beforeRefresh = await student.request("state");
  presenting.dispose();
  local.clear(); // Existing host tabs initially have the prior release's session-only record.
  await assert.rejects(student.request("trade", { action: "buy", side: "up" }), /Reconnect/);
  host = await presenting.create();
  assert.equal(host.id, presenting.currentHostId());
  const restored = await student.request("state");
  assert.equal(restored.me.down, 1);
  assert.equal(restored.me.up, 0);
  assert.equal(restored.phase, "trading");
  assert.deepEqual(restored.ticketHistory, beforeRefresh.ticketHistory);
  assert.equal(restored.npcTrades, beforeRefresh.npcTrades);
  presenting.dispose(); playing.dispose(); watching.dispose();
  await new Promise(resolve => setImmediate(resolve));

  // Closing the presentation and reopening in a fresh tab preserves the invite,
  // but starts a clean room. Reopening the saved host URL also works.
  const reopened = tab();
  assert.equal(reopened.currentHostId(), host.id);
  const newRound = await reopened.create();
  assert.equal(newRound.joinUrl, originalInvite);
  assert.equal((await newRound.request("state")).phase, "lobby");
  assert.equal((await newRound.request("state")).players, 0);
  const guest = tab();
  const fromOldQR = await guest.join(new URL(originalInvite).searchParams.get("room"));
  assert.equal((await fromOldQR.request("join", { name: "New class" })).players, 1);
  reopened.dispose(); guest.dispose();
  await new Promise(resolve => setImmediate(resolve));
  const bookmarked = tab(new Map(), "https://example.github.io/bitcoin-replay/?host=" + host.id);
  assert.equal((await bookmarked.create()).joinUrl, originalInvite);
  bookmarked.dispose();
});
