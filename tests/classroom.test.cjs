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
  let latestReply;
  let holdNextReply = false, releaseReply;
  let legacyGuest = false, legacyHost = false;
  class Channel extends EventEmitter {
    send(value) {
      if (legacyGuest && value.path) delete value.feedAfter;
      if (legacyHost && value.state) {
        delete value.state.tradeFeed;
        delete value.state.feedStart;
        delete value.state.support;
      }
      if (value.state) latestReply = structuredClone(value.state);
      if (value.state && holdNextReply) {
        holdNextReply = false;
        releaseReply = () => this.other.emit("data", structuredClone(value));
        return;
      }
      queueMicrotask(() => { if (this.open) this.other.emit("data", structuredClone(value)); });
    }
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
  const observer = await spectator.request("state");
  assert.deepEqual(observer.tradeFeed, unattended.tradeFeed);
  assert.deepEqual(observer.support, { up: 0, down: 0 });
  assert.deepEqual(observer.ticketHistory, unattended.ticketHistory);
  assert.deepEqual(observer.prices, unattended.prices);
  assert.equal(latestReply.priceOffset, 1);
  assert.equal(latestReply.prices.length, observer.prices.length - 1);
  const idle = await spectator.request("state");
  assert.deepEqual(idle.prices, unattended.prices);
  assert.deepEqual(idle.tradeFeed, observer.tradeFeed);
  assert.equal(latestReply.feedStart, observer.tradeFeed[0].id);
  assert.equal(latestReply.tradeFeed.length, 0);
  assert.equal(latestReply.prices.length, 0);
  const traded = await student.request("trade", { action: "buy", side: "down" });
  assert.equal(traded.me.down, 1);
  assert.ok(traded.quotes.buyUp < unattended.quotes.buyUp);
  const afterTrade = await spectator.request("state");
  assert.equal(afterTrade.ticketHistory.at(-1).price, traded.quotes.buyUp);
  assert.deepEqual(afterTrade.tradeFeed, traded.tradeFeed);
  assert.deepEqual(afterTrade.support, { up: 0, down: 1 });
  assert.equal(latestReply.tradeFeed.length, 1);
  assert.equal(latestReply.tradeFeed[0].name, "First table");
  assert.equal(latestReply.tradeFeed[0].actor, "team");
  assert.equal((await spectator.request("state")).tradeFeed.filter(fill => fill.actor === "team").length, 1);
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
  assert.deepEqual(restored.prices, beforeRefresh.prices);
  assert.equal(restored.npcTrades, beforeRefresh.npcTrades);
  assert.deepEqual(restored.tradeFeed, beforeRefresh.tradeFeed);
  milliseconds += 120000;
  const caughtUp = await student.request("state");
  assert.equal(caughtUp.tradeFeed.length, 64);
  assert.ok(caughtUp.tradeFeed[0].id > restored.tradeFeed.at(-1).id);
  assert.equal(latestReply.feedStart, undefined);
  const next = await student.request("trade", { action: "sell", side: "down", quantity: 1 });
  assert.equal(next.tradeFeed.length, 64);
  assert.equal(latestReply.tradeFeed.length, 1);
  assert.deepEqual(next.support, { up: 0, down: 0 });
  assert.equal(latestReply.feedStart, next.tradeFeed[0].id);
  assert.deepEqual(next.tradeFeed, structuredClone((await host.request("state")).tradeFeed));
  legacyGuest = true;
  assert.deepEqual((await student.request("state")).tradeFeed, next.tradeFeed);
  assert.equal(latestReply.feedStart, undefined);
  legacyGuest = false;
  legacyHost = true;
  assert.equal((await student.request("state")).tradeFeed, undefined);
  legacyHost = false;
  assert.deepEqual((await student.request("state")).tradeFeed, next.tradeFeed);
  await host.request("host", { action: "reset" });
  const clean = await student.request("state");
  assert.deepEqual(clean.tradeFeed, []);
  assert.deepEqual(clean.support, { up: 0, down: 0 });
  assert.notEqual(clean.roundId, restored.roundId);
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
  const restOfClass = Array.from({ length: 19 }, () => tab());
  const teams = await Promise.all(restOfClass.map(person => person.join(newRound.id)));
  await Promise.all(teams.map((team, index) => team.request("join", { name: "Table " + (index + 2) })));
  await newRound.request("host", { action: "start" });
  milliseconds += 40000;
  const classViews = await Promise.all([fromOldQR, ...teams].map(team => team.request("state")));
  for (const view of classViews) {
    assert.equal(view.players, 20);
    assert.equal(view.npcCount, 20);
    assert.deepEqual(view.prices, classViews[0].prices);
    assert.deepEqual(view.ticketHistory, classViews[0].ticketHistory);
    assert.equal(view.npcTrades, classViews[0].npcTrades);
  }
  // A student spends their practice budget in a single request. Both their
  // purchase and their exit change the quotes in a different student's tab.
  const openingQuote = classViews[0].bulk.down.buy[100];
  const bought = await fromOldQR.request("trade", {
    side: "down", action: "buy", quantity: openingQuote.quantity, quoteLimit: openingQuote.total,
  });
  assert.equal(bought.me.down, openingQuote.quantity);
  assert.ok(bought.me.cash >= 0);
  const classmate = await teams[0].request("state");
  assert.equal(classmate.quotes.buyDown, bought.quotes.buyDown);
  assert.ok(classmate.quotes.buyDown > classViews[0].quotes.buyDown);
  const exit = bought.bulk.cashOut;
  const liquidated = await fromOldQR.request("trade", {
    side: "both", action: "sellAll", quantity: exit.quantity, quoteLimit: exit.total,
  });
  assert.equal(liquidated.me.down, 0);
  assert.ok(Math.abs(liquidated.me.cash - 100) < .0002);
  assert.deepEqual((await teams[0].request("state")).quotes, classViews[0].quotes);
  // Deliver a poll after a newer confirmed trade. A following delta must still
  // reconstruct the authoritative chart and wallet, not use the late cache.
  holdNextReply = true;
  const delayedPoll = fromOldQR.request("state");
  await new Promise(resolve => setImmediate(resolve));
  milliseconds += 1500;
  const receiptView = await fromOldQR.request("trade", {
    side: "up", action: "buyCash", amount: 5, orderId: "late-poll-check",
  });
  assert.equal(receiptView.tradeReceipt.orderId, "late-poll-check");
  releaseReply();
  const older = await delayedPoll;
  assert.ok(older.revision < receiptView.revision);
  const latest = await fromOldQR.request("state");
  const authoritative = await newRound.request("state");
  assert.equal(latest.me.cash, receiptView.me.cash);
  assert.equal(latest.myTrades.at(-1).orderId, "late-poll-check");
  assert.deepEqual(latest.ticketHistory, structuredClone(authoritative.ticketHistory));
  assert.deepEqual(latest.prices, structuredClone(authoritative.prices));
  assert.deepEqual(latest.tradeFeed, structuredClone(authoritative.tradeFeed));
  assert.ok(latest.revision > receiptView.revision);
  restOfClass.forEach(person => person.dispose());
  reopened.dispose(); guest.dispose();
  await new Promise(resolve => setImmediate(resolve));
  const bookmarked = tab(new Map(), "https://example.github.io/bitcoin-replay/?host=" + host.id);
  assert.equal((await bookmarked.create()).joinUrl, originalInvite);
  bookmarked.dispose();
});
