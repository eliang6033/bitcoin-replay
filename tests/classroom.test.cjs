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
  function tab() {
    const values = new Map();
    const context = vm.createContext({
      crypto: webcrypto, Peer, URL, AbortSignal, setTimeout, clearTimeout, addEventListener() {},
      fetch: async () => ({ ok: true, json: async () => JSON.parse(source("history.json")) }),
      location: { href: "https://example.github.io/bitcoin-replay/" },
      history: { replaceState() {} },
      sessionStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) },
    });
    vm.runInContext(source("room-engine.js"), context);
    vm.runInContext(source("classroom.js"), context);
    return context.BitcoinClassroom;
  }
  const presenting = tab(), playing = tab(), watching = tab();
  let host = await presenting.create();
  const student = await playing.join(host.id);
  const spectator = await watching.join(host.id);
  assert.equal(new URL(host.joinUrl).searchParams.get("room"), host.id);
  assert.equal((await student.request("state")).host, false);
  assert.equal((await host.request("state")).host, true);
  await assert.rejects(student.request("host", { action: "start" }), /Students can join and trade only/);
  await student.request("join", { name: "First table" });
  assert.equal((await spectator.request("state")).me, null);
  await host.request("host", { action: "start" });
  const traded = await student.request("trade", { action: "buy", side: "down" });
  assert.equal(traded.me.down, 1);
  assert.equal(traded.reveal, null);
  presenting.dispose();
  await assert.rejects(student.request("trade", { action: "buy", side: "up" }), /Reconnect/);
  host = await presenting.create();
  assert.equal(host.id, presenting.currentHostId());
  const restored = await student.request("state");
  assert.equal(restored.me.down, 1);
  assert.equal(restored.me.up, 0);
  assert.equal(restored.phase, "trading");
  presenting.dispose(); playing.dispose(); watching.dispose();
});
