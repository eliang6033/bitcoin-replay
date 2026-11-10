const {test} = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
globalThis.crypto ||= webcrypto;
require('../public/room-engine.js');
const history = require('../public/history.json');
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
async function fixture(t) {
  const {openDatabase} = await import('../shared-server/sqlite.mjs');
  const {createService} = await import('../shared-server/service.mjs');
  const db = await openDatabase(); t.after(() => db.close());
  let now = 1000000;
  const make = () => createService(history, {clock:() => now});
  const service = make();
  async function send(path, body, token, target = service) {
    const headers = {'Origin':'https://eliang6033.github.io'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await target.fetch(new Request('https://service.example/api/' + path, {
      method:body ? 'POST' : 'GET', headers, body:body ? JSON.stringify(body) : undefined,
    }), {DB:db});
    return {status:response.status, data:await response.json(), headers:response.headers};
  }
  const first = (await send('state')).data;
  const join = (name, token) => send('join', {name, roundId:first.roundId}, token);
  return {send, first, join, make, db, advance:ms => {now += ms;}};
}

test('one shared room: spectators are not players; identities survive another server instance', async t => {
  const f = await fixture(t);
  assert.equal(f.first.players,0); assert.equal(f.first.me,null); assert.equal(f.first.host,false);
  assert.equal(f.first.sharedRoom,true); assert.equal(f.first.joinUrl,'https://eliang6033.github.io/bitcoin-replay/?room=CLASSROOM');
  assert.equal((await f.join('Eli',A)).status,200);
  assert.equal((await f.join('Jerry',B)).status,200);
  const recovered = await f.send('state',null,A,f.make());
  assert.equal(recovered.data.me.name,'Eli'); assert.equal(recovered.data.me.cash,100);
  assert.equal(recovered.data.players,2); assert.equal(recovered.data.canControl,true);
  assert.equal((await f.send('state',null,C)).data.me,null);
  assert.equal((await f.join('eli',C)).status,409);
  assert.equal((await f.send('control',{action:'start',roundId:f.first.roundId},C)).status,403);
  assert.equal((await f.send('join',{name:'No identity',roundId:f.first.roundId})).status,401);
  assert.equal(recovered.headers.get('access-control-allow-origin'),'https://eliang6033.github.io');
  assert(!JSON.stringify(recovered.data).includes(A));
});

test('twenty concurrent joins and orders are atomic with no lost players or overspending', async t => {
  const f = await fixture(t);
  const tokens = Array.from({length:20},(_,i) => (i+1).toString(16).padStart(64,'0'));
  const joins = await Promise.all(tokens.map((key,i) => f.join('Player '+i,key)));
  assert(joins.every(r => r.status === 200), JSON.stringify(joins.filter(r => r.status !== 200)));
  assert.equal((await f.send('state')).data.players,20);
  assert.equal((await f.send('control',{action:'start',roundId:f.first.roundId},tokens[9])).status,200);
  const orders = await Promise.all(tokens.map((key,i) => f.send('trade',{
    side:i % 2 ? 'up':'down', action:'buyCash', amount:100, orderId:'buy-'+i, roundId:f.first.roundId,
  },key)));
  assert(orders.every(r => r.status === 200));
  for (const order of orders) {assert.equal(order.data.me.cash,0); assert.equal(order.data.myTrades.length,1);}
  const audit = await f.send('audit',null,tokens[0]);
  assert.equal(audit.data.trades.length,20); assert.equal(audit.data.players.length,20);
  for(const p of audit.data.players) assert.equal(p.cash,0);
});

test('duplicate trade is filled once, stale quotes fail, and one player cannot spend another balance', async t => {
  const f = await fixture(t); await f.join('Eli',A); await f.join('Jerry',B);
  await f.send('control',{action:'start',roundId:f.first.roundId},A);
  const order = {side:'up',action:'buyCash',amount:25,orderId:'same',roundId:f.first.roundId};
  const replies = await Promise.all([f.send('trade',order,A),f.send('trade',order,A)]);
  assert(replies.every(r => r.status === 200 && r.data.me.cash === 75));
  assert.equal((await f.send('state',null,A)).data.myTrades.length,1);
  assert.equal((await f.send('state',null,B)).data.me.cash,100);
  assert.equal((await f.send('trade',{...order,orderId:'overspend',amount:100},A)).status,400);
  assert.equal((await f.send('trade',{...order,orderId:'bad-price',minQuantity:99999},A)).status,409);
  assert.equal((await f.send('trade',{...order,orderId:'stranger'},C)).status,403);
  assert.equal((await f.send('state',null,A)).data.me.cash,75);
});

test('the wall clock and NPCs continue without browsers; no active reset; everyone shares settlement', async t => {
  const f = await fixture(t); await f.join('Eli',A); await f.join('Jerry',B);
  const starts = await Promise.all([A,B].map(key => f.send('control',{action:'start',roundId:f.first.roundId},key)));
  assert.deepEqual(starts.map(r => r.status).sort(),[200,409]);
  assert.equal((await f.send('control',{action:'reset',roundId:f.first.roundId},A)).status,409);
  assert.equal((await f.send('control',{action:'reset',roundId:f.first.roundId},C)).status,409);
  f.advance(10000);
  const resumed = (await f.send('state',null,B,f.make())).data;
  assert.equal(resumed.elapsed,10); assert(resumed.npcTrades > 50);
  f.advance(291000);
  const ended = (await f.send('state',null,A,f.make())).data;
  assert.equal(ended.phase,'settled'); assert.equal(ended.remaining,0); assert.equal(ended.rankings.length,2);
  const spectator = (await f.send('state')).data;
  assert.deepEqual(spectator.rankings,ended.rankings); assert.equal(spectator.me,null);
  assert.equal(spectator.canReset,true);
  const next = await f.send('control',{action:'reset',roundId:ended.roundId},C);
  assert.equal(next.status,200); assert.equal(next.data.phase,'lobby'); assert.equal(next.data.players,0);
  assert.notEqual(next.data.roundId,ended.roundId); assert(next.data.revision > ended.revision);
  assert.equal((await f.send('join',{name:'Late request',roundId:ended.roundId},C)).status,409);
  assert.equal((await f.send('join',{name:'Eli',roundId:next.data.roundId},A)).status,200);
});

test('public service rejects unsupported methods, malformed payloads, and unwanted browser origins', async t => {
  const {createService} = await import('../shared-server/service.mjs'); const app=createService(history);
  async function raw(path,options={}) { return app.fetch(new Request('https://service.example'+path, options),{}); }
  assert.equal((await raw('/api/state',{method:'POST'})).status,405);
  assert.equal((await raw('/api/state',{headers:{Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await raw('/api/host')).status,404);
  assert.equal((await raw('/api/join',{method:'POST',headers:{Authorization:'Bearer '+A,'Content-Type':'application/json'},body:'null'})).status,400);
  const preflight=await raw('/api/trade',{method:'OPTIONS',headers:{Origin:'https://eliang6033.github.io'}});
  assert.equal(preflight.status,204); assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
});

test('client preserves room links, restores identity, offers a chooser at the root and never auto-retries trades', async () => {
  const profile=new Map(); let calls=[], revision=1;
  function tab(url) {
    const location={href:url};
    const ctx=vm.createContext({crypto:webcrypto,URL,AbortSignal,location,
      localStorage:{getItem:k=>profile.get(k),setItem:(k,v)=>profile.set(k,v)},
      history:{replaceState:(_,__,next)=>{location.href=String(next);}},
      fetch:async (url,options)=>{calls.push({url,options}); return {ok:true,json:async()=>({roundId:'one-room',revision:revision++})};},
    });
    vm.runInContext(readFileSync(require.resolve('../public/shared-room.js'),'utf8'),ctx);
    const entry = ctx.BitcoinSharedRoom.entry();
    return {ctx,entry,session:entry.code ? ctx.BitcoinSharedRoom.connect(entry.code) : null,location};
  }
  assert.equal(tab('https://eliang6033.github.io/bitcoin-replay/').session,null);
  assert.equal(tab('https://eliang6033.github.io/bitcoin-replay/?room=bad').entry.invalid,true);
  const a=tab('https://eliang6033.github.io/bitcoin-replay/?room=abcd2345#leaderboard');
  await a.session.request('state');
  assert.equal(a.location.href,'https://eliang6033.github.io/bitcoin-replay/?room=ABCD2345#leaderboard');
  assert(calls[0].url.endsWith('/api/state?room=ABCD2345'));
  const identity=calls[0].options.headers.Authorization;
  await a.session.request('join',{name:'Eli'});
  assert.equal(JSON.parse(calls[1].options.body).roundId,'one-room');
  const b=tab('https://eliang6033.github.io/bitcoin-replay/?host='+'a'.repeat(24));
  assert.equal(b.entry.code,'CLASSROOM');
  await b.session.request('state'); assert.equal(calls[2].options.headers.Authorization,identity);
  assert(calls[2].url.endsWith('?room=CLASSROOM'));
  assert.equal(tab('https://eliang6033.github.io/bitcoin-replay/').ctx.BitcoinSharedRoom.lastRoom(),'CLASSROOM');
  let attempts=0; b.ctx.fetch=async()=>{attempts++;throw Error('Connection lost');};
  await assert.rejects(b.session.request('trade',{orderId:'test'}),/Connection lost/);
  assert.equal(attempts,1);
});

test('rooms isolate names, cash, orders, NPCs, clocks, rankings, resets and audit logs', async t => {
  const f = await fixture(t);
  const create = async (token) => {
    const r = await f.send('create',{creationId:crypto.randomUUID()},token);
    assert.equal(r.status,200); assert.match(r.data.roomCode,/^[A-HJ-NP-Z2-9]{8}$/);
    return r.data.roomCode;
  };
  const [a,b] = await Promise.all([create(A),create(B)]);
  assert.notEqual(a,b);
  const call = (code,path,body,token=A) => f.send(path+'?room='+code,body,token);
  const sa=(await call(a,'state')).data, sb=(await call(b,'state')).data;
  assert.equal(sa.joinUrl,'https://eliang6033.github.io/bitcoin-replay/?room='+a);
  assert.notEqual(sa.roundId,sb.roundId);
  assert.equal((await call(a,'join',{name:'Eli',roundId:sa.roundId})).status,200);
  assert.equal((await call(b,'join',{name:'Eli',roundId:sb.roundId})).status,200);
  await call(a,'control',{action:'start',roundId:sa.roundId});
  f.advance(10000);
  const trade={side:'up',action:'buyCash',amount:25,orderId:'isolated-order',roundId:sa.roundId};
  assert.equal((await call(a,'trade',trade)).status,200);
  const untouched=(await call(b,'state')).data;
  assert.equal(untouched.phase,'lobby'); assert.equal(untouched.remaining,300);
  assert.equal(untouched.me.cash,100); assert.equal(untouched.npcTrades,0); assert.equal(untouched.myTrades.length,0);
  assert.deepEqual(untouched.rankings,[{name:'Eli',points:100}]);
  assert.equal((await call(b,'trade',trade)).status,409);
  assert.equal((await call(a,'audit')).data.trades.length,1);
  assert.equal((await call(b,'audit')).data.trades.length,0);
  f.advance(300000);
  const ended=(await call(a,'state')).data;
  await call(a,'control',{action:'reset',roundId:ended.roundId},C);
  const preserved=(await call(b,'state')).data;
  assert.equal(preserved.roundId,sb.roundId); assert.equal(preserved.players,1);
  assert.equal((await f.send('state')).data.players,0); // Legacy room is separate too.
  const persisted=(await f.send('state?room='+b,null,A,f.make())).data;
  assert.equal(persisted.me.name,'Eli'); assert.equal(persisted.roomCode,b);
});

test('creation retries return the same room without resetting it; unknown codes never create rooms', async t => {
  const f=await fixture(t), body={creationId:crypto.randomUUID()};
  const both=await Promise.all([f.send('create',body,A),f.send('create',body,A)]);
  assert.equal(both[0].data.roomCode,both[1].data.roomCode);
  const code=both[0].data.roomCode;
  const before=(await f.send('state?room='+code)).data;
  await f.send('join?room='+code,{name:'Eli',roundId:before.roundId},A);
  await f.send('control?room='+code,{action:'start',roundId:before.roundId},A);
  await f.send('create',body,A);
  const after=(await f.send('state?room='+code,null,A)).data;
  assert.equal(after.phase,'trading'); assert.equal(after.roundId,before.roundId); assert.equal(after.players,1);
  assert.equal((await f.send('state?room=ZZZZZZZZ')).status,404);
  assert.equal((await f.send('state?room=')).status,400);
  assert.equal((await f.send('create',{})).status,401);
  assert.equal((await f.send('create',{creationId:'bad'},A)).status,400);
  assert.equal(await f.db.prepare('SELECT id FROM rooms WHERE id = ?').bind('ZZZZZZZZ').first(),null);
});
