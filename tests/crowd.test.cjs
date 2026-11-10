const {test} = require('node:test');
const assert = require('node:assert/strict');
const data = require('../public/history.json');
globalThis.crypto ??= require('node:crypto').webcrypto;
require('../public/room-engine.js');

test('120 smaller NPC wallets use bounded orders and keep balances reconciled for a full round', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const room = new BitcoinReplayRoom(data, {clock:()=>0, seed});
    assert.equal(room.market.traders.length, 120);
    assert.equal(new Set(room.market.traders.map(p => p.name)).size, 120);
    assert.ok(room.market.traders.every(p => p.cash <= 500 && p.cash > 450));
    const players = new Set(), actions = new Set();
    const record = room.recordTrade.bind(room);
    room.recordTrade = (...args) => {
      const [second, actor, name, action, side, quantity, cost] = args;
      assert.equal(actor, 'npc');
      assert.ok(Math.abs(cost) > 0 && Math.abs(cost) <= 100 + 1e-9, `${name}: oversized fill ${cost}`);
      assert.ok(second < 300 && quantity > 0);
      players.add(name); actions.add(action);
      record(...args);
    };
    room.advanceMarket(300);
    assert.equal(players.size, 120, 'all NPCs participate, not just renamed large accounts');
    assert.deepEqual(actions, new Set(['buy', 'sell']));
    assert.ok(room.market.trades > 4000 && room.market.trades < 9000);
    assert.ok(room.market.traders.every(p => p.cash >= 0 && p.up >= 0 && p.down >= 0));
    for (const side of ['up', 'down']) {
      assert.equal(room.units[side], room.market.traders.reduce((sum, p) => sum + p[side], 0));
    }
  }
});
