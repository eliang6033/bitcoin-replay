const { test } = require("node:test");
const assert = require("node:assert/strict");
const data = require("../public/history.json");
globalThis.crypto ??= require("node:crypto").webcrypto;
require("../public/room-engine.js");

function setup(history = data, saved) {
  let now = 0;
  const room = new BitcoinReplayRoom(history, { clock: () => now, seed: 1234, saved });
  return {
    room,
    at(seconds) { now = seconds; return this.get(); },
    get() { return room.request("state", null, "student", false, "/"); },
    start() { return room.request("host", { action: "start" }, "host", true, "/"); },
    student(path, body) { return room.request(path, body, "student", false, "/"); },
  };
}

test("synthetic opening is balanced, NPCs share the students' book, totals reconcile", () => {
  const sim = setup();
  const lobby = sim.get();
  assert.equal(lobby.npcCount, 20);
  assert.equal(lobby.npcTrades, 0);
  assert.equal(lobby.players, 0);
  assert.deepEqual(lobby.rankings, []);
  assert.equal(lobby.ticketHistory[0].second, -12);
  assert.equal(lobby.ticketHistory.at(-1).second, 0);
  assert.equal(lobby.ticketHistory.at(-1).price, lobby.quotes.buyUp);
  assert.ok(new Set(lobby.ticketHistory.map(p => p.price)).size > 1);
  sim.student("join", { name: "Table A" });
  sim.start();
  const current = sim.at(30);
  const buy = sim.student("trade", { side: "up", action: "buy", quantity: 5 });
  assert.ok(buy.quotes.buyUp > current.quotes.buyUp + .2);
  assert.equal(buy.ticketHistory.at(-1).price, buy.quotes.buyUp);
  assert.equal(buy.npcTrades, current.npcTrades);
  assert.equal(buy.me.up, 5);
  assert.deepEqual(buy.rankings.map(p => p.name), ["Table A"]);

  const final = sim.at(300);
  assert.equal(final.ticketHistory.at(-1).price, final.quotes.buyUp);
  assert.ok(final.npcTrades > 300 && final.npcTrades < 460);
  assert.deepEqual(sim.at(340).ticketHistory, final.ticketHistory);
  assert.ok(final.ticketHistory.every((p, i, h) => i === 0 || p.second > h[i - 1].second));
  const saved = sim.room.save();
  const seats = [...saved.market.traders, final.me];
  assert.ok(seats.every(p => p.cash >= 0 && p.up >= 0 && p.down >= 0));
  for (const side of ["up", "down"]) {
    assert.equal(seats.reduce((sum, p) => sum + p[side], 0), saved.units[side]);
  }
});

test("a quiet market ticks about once per second; a visible jump briefly accelerates trading", () => {
  const flat = structuredClone(data);
  for (const p of flat.prices) p.price = flat.prices[0].price;
  const shock = structuredClone(flat);
  for (const p of shock.prices.slice(16)) p.price *= 1.06;
  const quiet = setup(flat), active = setup(shock);
  quiet.start(); active.start();
  const before = quiet.at(19.99);
  assert.deepEqual(before.ticketHistory, active.at(19.99).ticketHistory);
  assert.equal(before.npcTrades, active.get().npcTrades);
  const quietFills = quiet.at(25.99).npcTrades - before.npcTrades;
  const shockFills = active.at(25.99).npcTrades - before.npcTrades;
  assert.ok(quietFills >= 5 && quietFills <= 8);
  assert.ok(shockFills >= 11 && shockFills <= 16);
  const seen = quiet.at(65);
  assert.deepEqual(quiet.at(65).ticketHistory, seen.ticketHistory);
  const stable = active.at(35).npcTrades;
  assert.ok(active.at(55).npcTrades - stable <= 24);
});

test("clock-driven catch-up matches repeated polls and survives host refresh", () => {
  const sparse = setup(), busy = setup();
  sparse.start(); busy.start();
  for (let s = .2; s < 93; s += .2) busy.at(s);
  const checkpoint = sparse.at(93);
  assert.deepEqual(busy.at(93).ticketHistory, checkpoint.ticketHistory);
  const reopened = setup(data, JSON.parse(JSON.stringify(sparse.room.save())));
  assert.deepEqual(reopened.at(211.25).ticketHistory, busy.at(211.25).ticketHistory);
  assert.deepEqual(reopened.at(300).quoteTotals, sparse.at(300).quoteTotals);
});

test("existing rounds keep their market on upgrade and get NPCs with the next reset", () => {
  const sim = setup();
  sim.student("join", { name: "Existing team" });
  sim.start();
  const saved = sim.room.save();
  // Pre-NPC sessions stored only real player inventory in the book.
  delete saved.market;
  saved.units = { up: 0, down: 0 };
  const legacy = setup(data, saved);
  assert.equal(legacy.at(100).npcCount, 0);
  assert.equal(legacy.get().npcTrades, 0);
  assert.equal(legacy.get().upPrice, 5);
  assert.equal(legacy.student("trade", { side: "up", action: "buy", quantity: 3 }).me.up, 3);
  const fresh = legacy.room.request("host", { action: "reset" }, "host", true, "/");
  assert.equal(fresh.npcCount, 20);
  assert.equal(fresh.players, 0);
});
