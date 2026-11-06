const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const data = require("../public/history.json");
globalThis.crypto ??= require("node:crypto").webcrypto;
require("../public/room-engine.js");

function simulate(saved) {
  let now = 0;
  const room = new BitcoinReplayRoom(data, { seed: 77, clock: () => now, saved });
  const request = (path, body, player = "secret-A") =>
    room.request(path, body, player, path === "host", "/");
  return {
    room, request,
    at(second) { now = second; return request("state"); },
    trade(side, action, quantity, orderId, player) {
      return request("trade", { side, action, quantity, orderId }, player);
    },
  };
}

test("one event per confirmed student order, mixed-position team counts and fresh round", () => {
  const sim = simulate();
  sim.request("join", { name: "Table <A>" });
  sim.request("join", { name: "Table B" }, "secret-B");
  const opening = sim.request("host", { action: "start" });
  assert.deepEqual(opening.tradeFeed, []);
  assert.deepEqual(opening.support, { up: 0, down: 0 });
  const order = sim.trade("up", "buy", 3, "private-order");
  assert.deepEqual(order.tradeFeed, [{
    id: 1, actor: "team", name: "Table <A>", action: "buy", side: "up",
    quantity: 3, total: opening.quoteTotals.buyUp[2], second: 0,
  }]);
  assert.deepEqual(sim.trade("up", "buy", 3, "private-order").tradeFeed, order.tradeFeed);
  assert.throws(() => sim.trade("up", "sell", 5, "rejected"), /own/);
  assert.deepEqual(sim.request("state").tradeFeed, order.tradeFeed);
  const secondTeam = sim.trade("up", "buy", 1, "buy-B", "secret-B");
  assert.deepEqual(secondTeam.support, { up: 2, down: 0 });
  const mixed = sim.trade("down", "buy", 2, "buy-A-down");
  assert.deepEqual(mixed.support, { up: 2, down: 1 });
  const sold = sim.trade("up", "sell", 1, "partial");
  assert.deepEqual(sold.support, mixed.support);
  assert.equal(sold.tradeFeed.at(-1).total, mixed.quotes.sellUp);
  const exit = sim.trade("both", "sellAll", sold.bulk.cashOut.quantity, "exit");
  assert.deepEqual(exit.tradeFeed.at(-1), {
    id: 5, actor: "team", name: "Table <A>", action: "sellAll", side: "both",
    quantity: 4, total: sold.bulk.cashOut.total, second: 0,
  });
  assert.deepEqual(exit.support, { up: 1, down: 0 });
  assert.deepEqual(sim.trade("both", "sellAll", 4, "exit").tradeFeed, exit.tradeFeed);
  assert.deepEqual(sim.request("state", null, "secret-B").tradeFeed, exit.tradeFeed);
  sim.request("host", { action: "reset" });
  assert.deepEqual(sim.request("state").support, { up: 0, down: 0 });
  assert.deepEqual(sim.request("state").tradeFeed, []);
  sim.request("host", { action: "start" });
  assert.equal(sim.at(1.11).tradeFeed[0].id, 1);
});

test("NPC activity reconciles to real balances and follows the clock across catch-up and saves", () => {
  const sim = simulate();
  sim.request("host", { action: "start" });
  const actions = new Set();
  for (let i = 0; i < 30; i++) {
    const accounts = sim.room.market.traders.map(player => ({ ...player }));
    const second = sim.room.market.nextMs / 1000;
    const next = sim.at(second + 0.00001);
    const fill = next.tradeFeed.at(-1);
    const before = accounts.find(p => p.name === fill.name);
    const after = sim.room.market.traders.find(p => p.name === fill.name);
    const direction = fill.action === "buy" ? 1 : -1;
    assert.equal(fill.actor, "npc");
    assert.equal(fill.id, i + 1);
    assert.equal(fill.second, second);
    assert.equal(after[fill.side] - before[fill.side], direction * fill.quantity);
    assert.ok(Math.abs(before.cash - after.cash - direction * fill.total) < .00006);
    assert.deepEqual(next.support, { up: 0, down: 0 });
    actions.add(fill.action);
  }
  assert.deepEqual(actions, new Set(["buy", "sell"]));
  const checkpoint = sim.at(180);
  const saved = JSON.parse(JSON.stringify(sim.room.save()));
  const restored = simulate(saved);
  assert.deepEqual(restored.at(180).tradeFeed, checkpoint.tradeFeed);
  const latest = restored.at(300);
  assert.deepEqual(sim.at(300).tradeFeed, latest.tradeFeed);
  assert.equal(latest.tradeFeed.length, 64);
  assert.equal(latest.tradeFeed.at(-1).id, latest.npcTrades);
  latest.tradeFeed.slice(1).forEach((fill, i) => assert.equal(fill.id, latest.tradeFeed[i].id + 1));

  delete saved.tradeFeed;
  const upgraded = simulate(saved);
  assert.deepEqual(upgraded.at(180).tradeFeed, []);
  assert.equal(upgraded.at(185).tradeFeed[0].id, 1);
});

test("local and online students see the same fills and team counts", () => {
  const sim = simulate();
  sim.request("join", { name: "A" });
  sim.request("host", { action: "start" });
  const view = state => [state.tradeFeed, state.support];
  const expected = [view(sim.trade("up", "buy", 2)), view(sim.at(5)),
    view(sim.trade("down", "buy", 1)), view(sim.at(80)), view(sim.trade("both", "sellAll", 3))];
  const python = `
import json
from server import ROOT, Room
now = 0
room = Room(json.loads((ROOT / "history.json").read_text()), clock=lambda: now, seed=77)
key = room.join("A", "")
room.host_action("start")
def view():
    state = room.state(key, False, "/")
    return [state["tradeFeed"], state["support"]]
room.trade(key, "up", "buy", 2)
result = [view()]
now = 5
result.append(view())
room.trade(key, "down", "buy", 1)
result.append(view())
now = 80
result.append(view())
room.trade(key, "both", "sellAll", 3)
result.append(view())
print(json.dumps(result))
`;
  const result = spawnSync("python3", ["-c", python], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
});
