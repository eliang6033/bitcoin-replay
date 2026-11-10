const {test} = require('node:test');
const assert = require('node:assert/strict');
const data = require('../public/history.json');
globalThis.crypto ??= require('node:crypto').webcrypto;
require('../public/room-engine.js');
require('../public/trade-status.js');

function setup() {
  let now = 0;
  const room = new BitcoinReplayRoom(data, {clock: () => now, seed: 2026});
  const call = (path, body, key = 'eli') => room.request(path, body, key, key === 'eli', '/');
  call('join', {name: 'eli'});
  call('join', {name: 'jerry'}, 'jerry');
  call('host', {action: 'start'});
  return {room, call, at(n) {now = n; return call('state');}};
}

test('confirmed receipts reconcile cash, survive ticker eviction, reload and duplicate requests', () => {
  const sim = setup();
  const order = {action: 'buyCash', side: 'down', amount: 25, orderId: 'eli-down'};
  const bought = sim.call('trade', order);
  assert.equal(bought.tradeReceipt.cashBefore, 100);
  assert.equal(bought.tradeReceipt.cashAfter, 75);
  assert.equal(bought.tradeReceipt.total, 25);
  assert.equal(bought.tradeReceipt.orderId, order.orderId);
  assert.deepEqual(sim.call('trade', order).tradeReceipt, bought.tradeReceipt);
  assert.equal(sim.call('state', null, 'jerry').myTrades.length, 0);
  const s = sim.at(200);
  assert.equal(s.tradeFeed.some(f => f.orderId === order.orderId), false);
  assert.equal(s.myTrades.length, 1);
  const sold = sim.call('trade', {action: 'sell', side: 'down', quantity: s.me.down, orderId: 'eli-exit'});
  assert.ok(Math.abs(sold.me.cash - s.me.cash - sold.tradeReceipt.total) < .00011);
  assert.ok(Math.abs(sold.me.points - s.me.points) < .00011, 'selling itself does not destroy liquidation value');
  assert.equal(sold.me.down, 0);
  const restored = new BitcoinReplayRoom(data, {clock: () => 200, saved: sim.room.save()});
  assert.deepEqual(restored.request('state', null, 'eli', true, '/').myTrades, sold.myTrades);
  assert.equal(restored.request('state', null, 'eli', true, '/').auditComplete, true);
  assert.throws(() => sim.call('audit', null, 'jerry'), /Only the host/);
  const report = sim.call('audit');
  assert.equal(report.trades.length, 2);
  assert.equal(JSON.stringify(report).includes('eli-down'), true);
  assert.equal(JSON.stringify(report).includes('"players":[["eli"'), false);
  assert.equal(report.winner, null);
});

test('a 10 percent Up price is not the average cost of a large purchase, and losing Up pays zero', () => {
  const sim = setup();
  sim.room.market.traders = [];
  sim.room.units.down = sim.room.units.up + sim.room.market.liquidity * Math.log(9);
  const s = sim.call('state');
  assert.equal(s.upPrice, 1);
  const purchase = sim.call('trade', {side: 'up', action: 'buyCash', amount: 25, orderId: 'cheap-up'});
  assert.ok(purchase.tradeReceipt.averagePrice > 1);
  assert.equal(purchase.me.cash, 75);
  assert.ok(Math.abs(purchase.me.points - 100) < .0001);
  const final = sim.at(300);
  assert.equal(final.reveal.winner, 'down');
  assert.equal(final.me.points, 75);
});

test('upgrading an old round preserves balances and explicitly marks recovered history as incomplete', () => {
  const sim = setup();
  const before = sim.call('trade', {side:'up', action:'buyCash', amount:25});
  const old = sim.room.save();
  delete old.tradeLog; delete old.auditComplete; delete old.revision;
  const restored = new BitcoinReplayRoom(data, {clock: () => 0, saved: old});
  const current = restored.request('state', null, 'eli', true, '/');
  assert.deepEqual(current.me, before.me);
  assert.equal(current.auditComplete, false);
  assert.equal(current.myTrades[0].legacy, true);
  assert.equal(current.myTrades[0].total, 25);
});

test('feedback distinguishes receipt proceeds, rejected orders and unknown acknowledgements', () => {
  const receipt = BitcoinTradeStatus.receipt({action:'sell',side:'down',quantity:1,total:9.5,cashAfter:95});
  assert.match(receipt.headline, /Received \$9,500/);
  assert.match(receipt.details, /not the same as profit/);
  const rejected = BitcoinTradeStatus.failure({message:'The price changed. Check the new total and try again.',rejected:true});
  assert.match(rejected.headline, /Not filled/);
  assert.match(rejected.details, /did not change your cash/);
  assert.equal(BitcoinTradeStatus.failure({message:'timeout'}).kind, 'uncertain');
});

test('late polls cannot overwrite a newer host state, even when request order differs', () => {
  const current = {roundId:'round',revision:20};
  assert.equal(BitcoinTradeStatus.shouldApply(current,{roundId:'round',revision:19},6,5),false);
  assert.equal(BitcoinTradeStatus.shouldApply(current,{roundId:'round',revision:21},4,5),true);
  assert.equal(BitcoinTradeStatus.shouldApply(current,{roundId:'old',revision:900},4,5),false);
  assert.equal(BitcoinTradeStatus.shouldApply(current,{roundId:'new',revision:1},6,5),true);
});
