const {test} = require('node:test');
const assert = require('node:assert/strict');
const data = require('../public/history.json');
const legacy = require('./fixtures/shallow-market.json');
const deepV1 = require('./fixtures/deep-market-v1.json');
globalThis.crypto ??= require('node:crypto').webcrypto;
require('../public/room-engine.js');

function fixedBook(chance, cash = 100) {
  const room = new BitcoinReplayRoom(data, {clock: () => 0, seed: 1234});
  room.request('join', {name:'Player'}, 'player', true, '/');
  room.request('host', {action:'start'}, 'player', true, '/');
  // A fixed test book isolates the player's price impact from incoming NPC orders.
  room.market.traders = [];
  const difference = room.market.liquidity * Math.log(chance / (1 - chance));
  room.units = {up: Math.max(0, difference), down: Math.max(0, -difference)};
  room.players.get('player').cash = cash;
  return {room, call: (path, body) => room.request(path, body, 'player', true, '/')};
}

test('a normal full wallet moves either outcome by less than two percentage points', () => {
  for (const chance of [.001, .01, .06208, .1, .5, .9, .99, .999]) {
    for (const side of ['up', 'down']) {
      const {room, call} = fixedBook(chance);
      const start = room.probability(side);
      const buy = call('trade', {side, action:'buyCash', amount:100});
      const impact = room.probability(side) - start;
      assert.ok(impact > 0 && impact < .02, `${side} at ${chance}: ${impact}`);
      assert.equal(buy.me.cash, 0);
      assert.equal(buy.me.points, 100, 'a purchase cannot create or destroy cash-out value by itself');
      const sale = call('trade', {side, action:'sell', quantity:buy.me[side]});
      assert.equal(sale.me.cash, 100);
      assert.equal(sale.me[side], 0);
      assert.ok(Math.abs(room.probability(side) - start) < 1e-10);
    }
  }
});

test('the previously oversized purchase has a modest impact and can profit after a real market move', () => {
  const {room, call} = fixedBook(.06207983148757137, 247.8071);
  const buy = call('trade', {side:'up', action:'buyCash', amount:247.8071});
  assert.ok(room.probability('up') > .10 && room.probability('up') < .105);
  assert.ok(buy.tradeReceipt.averagePrice > .62 && buy.tradeReceipt.averagePrice < .85);
  // Actual counterparty buying, rather than a mark-up of the user's own holdings.
  room.request('join', {name:'Other buyer'}, 'other', false, '/');
  room.players.get('other').cash = 1000;
  room.request('trade', {side:'up', action:'buyCash', amount:500}, 'other', false, '/');
  const sold = call('trade', {side:'up', action:'sell', quantity:buy.me.up});
  assert.ok(sold.me.cash > 247.8071);
});

test('twenty classmates still have a meaningful combined effect on the same book', () => {
  const {room} = fixedBook(.5);
  for (let i = 0; i < 20; i++) {
    const key = 'student-' + i;
    room.request('join', {name:key}, key, false, '/');
    room.request('trade', {side:'up', action:'buyCash', amount:100}, key, false, '/');
  }
  assert.ok(room.probability('up') > .65 && room.probability('up') < .66);
});

test('real pre-upgrade snapshots retain their original future quotes, balances and NPC schedule', () => {
  let now = 30;
  const room = new BitcoinReplayRoom(data, {clock: () => now, saved: structuredClone(legacy.saved)});
  assert.equal(room.market.liquidity, 18);
  assert.equal(room.market.npcLot, 1);
  for (const expected of legacy.expected) {
    now = expected.second;
    const s = room.request('state', null, 'compatibility-seat', true, '/');
    assert.equal(s.upPrice, expected.upPrice);
    assert.equal(s.npcTrades, expected.npcTrades);
    assert.deepEqual(s.me, expected.me);
    assert.equal(s.currentMarketRules, false);
  }
  const fresh = room.request('host', {action:'reset'}, 'compatibility-seat', true, '/');
  assert.equal(fresh.currentMarketRules, true);
  assert.equal(room.market.liquidity, 540);
  assert.equal(room.market.npcLot, 30);
});

test('deep-market rounds also keep their original NPC opinions until reset', () => {
  let now = 30;
  const room = new BitcoinReplayRoom(data, {clock: () => now, saved: structuredClone(deepV1.saved)});
  assert.equal(room.market.liquidity, 540);
  assert.equal(room.market.behaviorVersion, 1);
  for (const expected of deepV1.expected) {
    now = expected.second;
    const s = room.request('state', null, 'compatibility-seat', true, '/');
    assert.equal(s.upPrice, expected.upPrice);
    assert.equal(s.npcTrades, expected.npcTrades);
    assert.deepEqual(s.me, expected.me);
    assert.equal(s.currentMarketRules, false);
  }
  const fresh = room.request('host', {action:'reset'}, 'compatibility-seat', true, '/');
  assert.equal(fresh.currentMarketRules, true);
  assert.equal(room.market.behaviorVersion, 2);
});
