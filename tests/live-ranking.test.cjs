const {test} = require('node:test');
const assert = require('node:assert/strict');
const data = require('../public/history.json');
globalThis.crypto ??= require('node:crypto').webcrypto;
require('../public/room-engine.js');
require('../public/live-ranking.js');

test('live and final rankings use whole-dollar profit, keep ties, losses and inactive players', () => {
  const ranked = BitcoinLiveRanking.rank([
    {name:'Loss', points:90}, {name:'Idle', points:100},
    {name:'Taylor', points:120.0001}, {name:'Alex', points:120.0002},
  ]);
  assert.deepEqual(ranked.map(p => [p.name,p.profit,p.place]), [
    ['Alex',20000,1],['Taylor',20000,1],['Idle',0,3],['Loss',-10000,4],
  ]);
});

test('a spectator sees changing cash-out rankings without joining or adding NPCs to the board', () => {
  let now = 0;
  const room = new BitcoinReplayRoom(data, {clock:()=>now, seed:4});
  for (const name of ['Alex','Jordan','Idle']) room.request('join',{name},name,false,'/');
  room.request('host',{action:'start'},'host',true,'/');
  room.request('trade',{side:'up',action:'buyCash',amount:50},'Alex',false,'/');
  room.request('trade',{side:'down',action:'buyCash',amount:50},'Jordan',false,'/');
  const before = room.request('state',null,'spectator',false,'/');
  now = 125;
  const during = room.request('state',null,'spectator',false,'/');
  assert.equal(during.me,null);
  assert.equal(during.players,3);
  assert.equal(during.npcCount,120);
  assert.equal(during.rankings.length,3);
  assert.notDeepEqual(BitcoinLiveRanking.rank(before.rankings),BitcoinLiveRanking.rank(during.rankings));
  for (const row of during.rankings) {
    const personal = room.request('state',null,row.name,false,'/');
    assert.equal(row.points,personal.me.points);
  }
  const live = BitcoinLiveRanking.rank(during.rankings);
  assert.ok(live.find(p=>p.name==='Jordan').profit > live.find(p=>p.name==='Alex').profit);
  now = 300;
  const final = room.request('state',null,'spectator',false,'/');
  assert.equal(final.phase,'settled');
  for (const row of final.rankings) {
    const player = room.players.get(row.name);
    assert.equal(row.points,Math.round((player.cash + player[final.reveal.winner]*10)*10000)/10000);
  }
  room.request('host',{action:'reset'},'host',true,'/');
  assert.deepEqual(room.request('state',null,'spectator',false,'/').rankings,[]);
});
