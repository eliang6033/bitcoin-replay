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
