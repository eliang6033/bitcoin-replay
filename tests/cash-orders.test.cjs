const {test} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const data = require("../public/history.json");
globalThis.crypto ??= require("node:crypto").webcrypto;
require("../public/room-engine.js");

function setup() {
  let now = 0;
  const room = new BitcoinReplayRoom(data, {clock: () => now, seed: 2026});
  const call = (path, body) => room.request(path, body, "alex", path === "host", "/");
  call("join", {name: "Alex"});
  call("host", {action: "start"});
  return {room, call, at(time) { now = time; return call("state"); }};
}

test("dollar purchases use the chosen cash, survive retries and sell fractional positions completely", () => {
  const sim = setup();
  const order = {side: "up", action: "buyCash", amount: 25, orderId: "cash-1"};
  let s = sim.call("trade", order);
  assert.equal(s.me.cash, 75);
  assert.equal(s.tradeFeed.at(-1).total, 25);
  assert.equal(s.tradeFeed.at(-1).action, "buy");
  assert.ok(s.me.up > 0 && !Number.isInteger(s.me.up));
  assert.ok(Math.abs(s.me.cash + s.bulk.cashOut.total - 100) < 0.0001);
  const owned = s.me.up;
  s = sim.call("trade", order);
  assert.equal(s.me.cash, 75);
  assert.equal(s.me.up, owned);
  assert.equal(s.tradeFeed.filter(t => t.actor === "team").length, 1);
  assert.throws(() => sim.call("trade", {...order, amount: 10}), /reference/);
  s = sim.call("trade", {side: "up", action: "sell", quantity: s.bulk.up.exit.half.quantity});
  assert.equal(s.me.up, owned / 2);
  s = sim.call("trade", {side: "up", action: "sell", quantity: s.bulk.up.exit.all.quantity});
  assert.equal(s.me.up, 0);
  assert.ok(Math.abs(s.me.cash - 100) < 0.0001);
  s = sim.call("trade", {side: "down", action: "buyCash", amount: s.bulk.down.spend.all.amount});
  assert.equal(s.me.cash, 0);
  const snapshot = sim.room.save();
  const restored = new BitcoinReplayRoom(data, {clock: () => 0, saved: snapshot});
  assert.deepEqual(restored.request("state", null, "alex", false, "/").me, s.me);
  s = sim.at(300);
  assert.ok(Math.abs(s.me.points - s.me.down * 10) < 0.0001);
});

test("invalid or stale dollar orders leave balances and activity unchanged", () => {
  const sim = setup();
  const before = sim.room.save();
  for (const amount of [0, -1, 101, NaN, Infinity, "25", true]) {
    assert.throws(() => sim.call("trade", {side: "up", action: "buyCash", amount}), /amount/);
  }
  const quoted = sim.call("state").bulk.up.spend["25"].quantity;
  assert.throws(() => sim.call("trade", {side: "up", action: "buyCash", amount: 25, minQuantity: quoted + 1}), /price changed/);
  assert.deepEqual(sim.room.save(), before);
  sim.call("trade", {side: "up", action: "buyCash", amount: 50});
  sim.call("trade", {side: "down", action: "buyCash", amount: 50});
  const s = sim.call("state");
  const closed = sim.call("trade", {side: "both", action: "sellAll", quantity: s.bulk.cashOut.quantity});
  assert.equal(closed.me.up, 0);
  assert.equal(closed.me.down, 0);
  assert.ok(Math.abs(closed.me.cash - 100) < 0.0001);
});

test("browser and local server agree on dollar buys, NPC moves, fractional exits and settlement", () => {
  const sim = setup();
  const actions = [
    {time: 12, side: "up", amount: 25},
    {time: 24, side: "down", amount: 50},
    {time: 70, side: "up", portion: "half"},
    {time: 105, side: "down", portion: "all"},
    {time: 190, side: "up", amount: "all"},
  ];
  const actual = [];
  for (const action of actions) {
    let s = sim.at(action.time);
    s = action.portion
      ? sim.call("trade", {side: action.side, action: "sell", quantity: s.bulk[action.side].exit[action.portion].quantity})
      : sim.call("trade", {side: action.side, action: "buyCash", amount: action.amount === "all" ? s.me.cash : action.amount});
    actual.push({cash: s.me.cash, up: s.me.up, down: s.me.down, odds: s.upPrice});
  }
  const final = sim.at(300);
  actual.push({cash: final.me.cash, up: final.me.up, down: final.me.down, odds: final.upPrice, total: final.me.points});
  const python = execFileSync("python3", ["-c", `
import json
from server import Room, ROOT
now = [0]
r = Room(json.loads((ROOT / "history.json").read_text()), clock=lambda: now[0], seed=2026)
k = r.join("Alex", None)
r.host_action("start")
results = []
for a in json.loads(input()):
    now[0] = a["time"]
    s = r.state(k, False, "/")
    if "portion" in a:
        r.trade(k, a["side"], "sell", s["bulk"][a["side"]]["exit"][a["portion"]]["quantity"])
    else:
        r.trade(k, a["side"], "buyCash", amount=s["me"]["cash"] if a["amount"] == "all" else a["amount"])
    s = r.state(k, False, "/")
    results.append(dict(cash=s["me"]["cash"], up=s["me"]["up"], down=s["me"]["down"], odds=s["upPrice"]))
now[0] = 300
s = r.state(k, False, "/")
results.append(dict(cash=s["me"]["cash"], up=s["me"]["up"], down=s["me"]["down"], odds=s["upPrice"], total=s["me"]["points"]))
print(json.dumps(results))
`], {cwd: require("node:path").resolve(__dirname, ".."), input: JSON.stringify(actions), encoding: "utf8"});
  JSON.parse(python).forEach((expected, i) => {
    for (const key of Object.keys(expected)) assert.ok(Math.abs(expected[key] - actual[i][key]) < 0.001, key);
  });
});
