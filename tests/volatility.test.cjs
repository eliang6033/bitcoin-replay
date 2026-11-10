const {test} = require('node:test');
const assert = require('node:assert/strict');
const data = require('../public/history.json');
globalThis.crypto ??= require('node:crypto').webcrypto;
require('../public/room-engine.js');

function replay(seed, version, history = data) {
  const room = new BitcoinReplayRoom(history, {clock: () => 0, seed});
  room.market.behaviorVersion = version;
  room.request('host', {action:'start'}, 'host', true, '/');
  const points = [];
  for (let time = 0; time <= 170; time += .25) {
    room.advanceMarket(time);
    points.push({time, chance: room.probability('up') * 100});
  }
  return {room, points};
}

test('the trough has two-way executable price changes without flattening the crash signal', () => {
  let oldVariation = 0, newVariation = 0;
  for (let seed = 1; seed <= 30; seed++) {
    for (const version of [1, 3]) {
      const {room, points} = replay(seed, version);
      const trough = points.filter(p => p.time >= 110 && p.time < 140);
      let rises = 0, falls = 0, freeze = 0, longestFreeze = 0, variation = 0;
      for (let i = 1; i < trough.length; i++) {
        const current = trough[i].chance, previous = trough[i - 1].chance;
        rises += current > previous;
        falls += current < previous;
        variation += Math.abs(current - previous);
        freeze = current.toFixed(1) === previous.toFixed(1) ? freeze + .25 : 0;
        longestFreeze = Math.max(longestFreeze, freeze);
      }
      if (version === 1) {
        oldVariation += variation;
        continue;
      }
      newVariation += variation;
      assert.ok(rises > 15 && falls > 15, `seed ${seed}: actual trades in both directions`);
      assert.ok(longestFreeze < 4, `seed ${seed}: price should not appear frozen for many seconds`);
      assert.ok(points.find(p => p.time === 125).chance < 10, `seed ${seed}: Down still strongly favored`);
      assert.ok(room.probability('up') > .19, `seed ${seed}: later rebound remains visible`);
      assert.ok(room.market.traders.every(p => p.cash >= 0 && p.up >= 0 && p.down >= 0));
      for (const side of ['up', 'down']) {
        assert.equal(room.units[side], room.market.traders.reduce((total, p) => total + p[side], 0));
      }
    }
  }
  assert.ok(newVariation > oldVariation * 1.25, 'actual low-price movement increases across seeds');
});

test('new NPC disagreements use only the price history revealed at the time', () => {
  const differentFuture = structuredClone(data);
  // At 170 replay seconds, historical minute 136 has been revealed.
  for (const candle of differentFuture.prices.slice(137)) candle.price *= 2;
  const original = replay(1234, 3), changed = replay(1234, 3, differentFuture);
  assert.deepEqual(changed.points, original.points);
  assert.deepEqual(changed.room.market.traders, original.room.market.traders);
  assert.deepEqual(changed.room.tradeFeed, original.room.tradeFeed);
});
