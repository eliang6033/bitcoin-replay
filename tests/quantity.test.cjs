const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const history = require("../public/history.json");
globalThis.crypto ??= require("node:crypto").webcrypto;
require("../public/room-engine.js");

test("total quotes price the entire order and track both teams' trades", () => {
  const room = new BitcoinReplayRoom(history, { clock: () => 10 });
  const request = (team, path, body) => room.request(path, body, team, false, "/");
  request("one", "join", { name: "Team One" });
  request("two", "join", { name: "Team Two" });
  const opening = room.request("host", { action: "start" }, "host", true, "/");
  const order = { action: "buy", side: "up", quantity: 10, quoteLimit: opening.quoteTotals.buyUp[9] };
  assert.ok(order.quoteLimit > 10 * opening.quotes.buyUp);
  const bought = request("one", "trade", order);
  assert.equal(bought.me.up, 10);
  assert.ok(Math.abs(bought.me.cash - (100 - order.quoteLimit)) < 0.00011);
  const seen = request("two", "state");
  assert.deepEqual(seen.quoteTotals, bought.quoteTotals);
  assert.ok(seen.quotes.buyUp > opening.quotes.buyUp);
  assert.ok(seen.quotes.buyDown < opening.quotes.buyDown);
  assert.equal(seen.me.cash, 100);
  assert.throws(() => request("two", "trade", order), /Another team traded/);
  assert.equal(request("two", "state").me.up, 0);
  const sold = request("one", "trade", { side: "up", action: "sell", quantity: 4, quoteLimit: bought.quoteTotals.sellUp[3] });
  assert.equal(sold.me.up, 6);
  assert.ok(Math.abs(sold.me.cash - bought.me.cash - bought.quoteTotals.sellUp[3]) < 0.00011);
  assert.throws(() => request("one", "trade", { side: "up", action: "sell", quantity: 7 }), /only sell/);
});

test("local Python classroom and online host quote the same totals for sizes 1–10", () => {
  const python = `
import json
from server import Room, ROOT, GameError
room = Room(json.loads((ROOT / "history.json").read_text()), clock=lambda: 0)
a, b = room.join("A", ""), room.join("B", "")
room.host_action("start")
opening = room.state(a, False, "/")["quoteTotals"]
room.trade(a, "down", "buy", 7, quote_limit=opening["buyDown"][6])
try:
    room.trade(b, "down", "buy", 7, quote_limit=opening["buyDown"][6])
except GameError as err:
    assert "Another team" in str(err)
else:
    raise AssertionError("Accepted an obsolete quote")
print(json.dumps(room.state(b, False, "/")["quoteTotals"]))
`;
  const result = spawnSync("python3", ["-c", python], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const online = new BitcoinReplayRoom(history);
  online.request("join", { name: "A" }, "a", false, "/");
  online.request("host", { action: "start" }, "host", true, "/");
  const state = online.request("trade", { side: "down", action: "buy", quantity: 7 }, "a", false, "/");
  assert.deepEqual(state.quoteTotals, JSON.parse(result.stdout));
});

test("budget buttons buy the largest affordable order and cannot create gains from one's own bet", () => {
  const room = new BitcoinReplayRoom(history, { clock: () => 0 });
  const call = (path, body) => room.request(path, body, "team", true, "/");
  call("join", { name: "Team A" });
  const start = call("host", { action: "start" });
  for (const [budget, quote] of Object.entries(start.bulk.up.buy)) {
    assert.ok(room.quote("up", quote.quantity) <= Number(budget));
    assert.ok(room.quote("up", quote.quantity + 1) > Number(budget));
  }
  const { quantity, total } = start.bulk.up.buy[100];
  assert.equal(quantity, 16);
  const bought = call("trade", { side: "up", action: "buy", quantity, quoteLimit: total });
  assert.equal(bought.me.points, 100);
  assert.equal(bought.rankings[0].points, 100);
  assert.equal(bought.bulk.up.buy[100].quantity, 0);
  assert.equal(bought.bulk.up.sell[100].quantity, quantity);
  assert.equal(bought.bulk.cashOut.total, total);
  const all = { side: "both", action: "sellAll", quantity, quoteLimit: total, orderId: "close" };
  const cleared = call("trade", all);
  assert.deepEqual(cleared.me, { name: "Team A", cash: 100, up: 0, down: 0, points: 100 });
  assert.deepEqual(call("trade", all).me, cleared.me);
  assert.deepEqual(call("state").quotes, start.quotes);
});

test("cash-out closes both outcomes at the joint book price, or rejects the entire order", () => {
  const room = new BitcoinReplayRoom(history, { clock: () => 0 });
  const call = (path, body) => room.request(path, body, "team", true, "/");
  call("join", { name: "Both" });
  call("host", { action: "start" });
  call("trade", { side: "up", action: "buy", quantity: 7 });
  const before = call("trade", { side: "down", action: "buy", quantity: 4 });
  const close = before.bulk.cashOut;
  assert.equal(close.quantity, 11);
  assert.ok(Math.abs(close.total - (40 - room.quote("up", -3))) < 0.0001);
  const sale = { side: "both", action: "sellAll", quantity: 11, quoteLimit: close.total };
  assert.throws(() => call("trade", { ...sale, quantity: 10 }), /holdings changed/);
  assert.throws(() => call("trade", { ...sale, quoteLimit: close.total + 1 }), /Another team/);
  assert.deepEqual(call("state").me, before.me);
  assert.deepEqual(call("state").quotes, before.quotes);
  const after = call("trade", sale);
  assert.equal(after.me.cash, before.me.points);
  assert.equal(after.me.up + after.me.down, 0);
});

test("very lopsided rooms keep large order and liquidation quotes finite in both implementations", () => {
  const room = new BitcoinReplayRoom(history, { clock: () => 0 });
  room.units = { up: 2400, down: 0 };
  const player = { cash: 100, up: 2000, down: 0 };
  const bulk = room.bulkQuotes(player);
  assert.ok(bulk.down.buy[100].quantity > 2300);
  assert.ok(bulk.down.buy[100].total <= 100);
  assert.ok(room.quote("down", bulk.down.buy[100].quantity + 1) > 100);
  assert.ok(bulk.cashOut.total > 19000 && bulk.cashOut.total <= 20000);
  const python = `
import json
from server import Room, ROOT
r = Room(json.loads((ROOT / "history.json").read_text()))
r.units = {"up": 2400, "down": 0}
print(json.dumps(r.bulk_quotes({"cash":100, "up":2000, "down":0}), allow_nan=False))
`;
  const result = spawnSync("python3", ["-c", python], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(bulk, JSON.parse(result.stdout));
});
