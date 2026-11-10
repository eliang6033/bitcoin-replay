const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../public/history.json");
globalThis.crypto ??= require("node:crypto").webcrypto;
require("../public/room-engine.js");

test("settlement ranks every joined player by actual payout, retaining ties and older seats", () => {
  let now = 0;
  const clock = () => now;
  const tiedClose = structuredClone(data);
  tiedClose.prices[tiedClose.prices.length - 1].price = tiedClose.prices[0].price;
  let room = new BitcoinReplayRoom(tiedClose, { clock, seed: 18 });
  const call = (key, path, body) => room.request(path, body, key, path === "host", "/");
  for (const name of ["Ari", "Casey", "Sam"]) call(name, "join", { name });
  call("host", "host", { action: "start" });
  call("Ari", "trade", { side: "down", action: "buy", quantity: 2 });
  const loss = call("Casey", "trade", { side: "up", action: "buy", quantity: 1 }).me;
  const mixed = call("Ari", "trade", { side: "down", action: "sell", quantity: 1 }).me;
  now = 299;
  call("Lee", "join", { name: "Lee" });
  const saved = room.save();
  delete saved.tradeFeed; // A prior release already had nickname, holdings and cash for every seat.
  room = new BitcoinReplayRoom(tiedClose, { clock, saved });
  now = 300;
  const spectator = call("never-joined", "state");
  assert.equal(spectator.reveal.winner, "down");
  assert.equal(spectator.me, null);
  assert.equal(spectator.npcCount, 120);
  assert.equal(spectator.players, 4);
  const rank = spectator.rankings;
  assert.deepEqual(rank.map(row => row.name), ["Ari", "Sam", "Lee", "Casey"]);
  assert.ok(Math.abs(rank[0].points - mixed.cash - 10) < .0002);
  assert.equal(rank[1].points, 100);
  assert.equal(rank[2].points, 100);
  assert.equal(rank[3].points, loss.cash);
  assert.ok(rank[0].points > 100 && rank[3].points < 100);
});

test("two peers trade in one market and continue after the host reloads", () => {
  let now = 1200;
  const clock = () => now;
  let room = new BitcoinReplayRoom(data, { clock });
  const request = (path, body, key = "a") => room.request(path, body, key, false, "/invite");
  const host = (action) => room.request("host", { action }, "host", true, "/invite");
  const buy = { side: "up", action: "buy", quantity: 3, orderId: "first" };

  assert.equal(request("join", { name: "Table A" }).me.cash, 100);
  assert.equal(request("/api/join", { name: "Table B" }, "b").players, 2);
  assert.throws(() => request("host", { action: "start", host: true }), /Only the host/);
  assert.throws(() => request("join", { name: "TABLE B" }, "other"), /taken/);
  const start = host("start");
  assert.equal(start.prices.length, 1);
  assert.equal(start.reveal, null);
  const owned = request("trade", buy).me;
  assert.equal(owned.up, 3);
  assert.ok(request("state", null, "b").upPrice > 5);
  assert.equal(request("state", null, "b").me.up, 0);
  assert.throws(() => request("trade", { side: "down", action: "sell" }), /only sell/);

  const saved = JSON.parse(JSON.stringify(room.save()));
  room = new BitcoinReplayRoom(data, { clock, saved });
  assert.deepEqual(request("trade", buy).me, owned);
  assert.throws(() => request("trade", { ...buy, quantity: 2 }), /reference/);
  assert.equal(request("trade", { side: "up", action: "sell", quantity: 3 }).me.cash, 100);
  now += 60;
  assert.equal(request("state").prices.at(-1).minute, 48);
  assert.deepEqual(request("state").network.blocks, []);

  const current = request("trade", { side: "down", action: "buy" }).me;
  now += 240;
  const end = request("state");
  assert.equal(end.phase, "settled");
  assert.equal(end.reveal.winner, "down");
  assert.equal(end.me.points, Number((current.cash + 10).toFixed(4)));
  assert.throws(() => request("trade", { side: "up", action: "buy" }), /closed/);
  host("network");
  now += 30;
  const partial = request("state");
  assert.ok(partial.network.blocks.length > 0);
  assert.ok(partial.network.blocks.every((b) => b.minute <= 120));
  assert.ok(partial.network.txCount < partial.reveal.txCount);
  now += 30;
  assert.equal(request("state").network.txCount, 53191);
  assert.equal(host("discussion").network.blocks.length, 21);
  assert.notEqual(host("reset").roundId, start.roundId);
  assert.equal(request("state").me, null);
});
