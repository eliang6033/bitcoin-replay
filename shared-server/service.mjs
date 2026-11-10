const PUBLIC_URL = 'https://eliang6033.github.io/bitcoin-replay/';
const ROOM = 'classroom';
const TICK_MS = 200;
const fail = (message, status = 400) => { throw Object.assign(Error(message), {status, rejected:true}); };

// One durable room, with compare-and-swap writes. No browser owns the clock.
// Replaying scheduled NPC events from the saved seed makes catch-up deterministic.
export function createService(history, {clock = () => Date.now(), duration = 300} = {}) {
  async function roomRequest(db, path, body, key) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const wallNow = clock();
      let row = await db.prepare('SELECT version, updated, snapshot FROM rooms WHERE id = ?').bind(ROOM).first();
      if (!row) {
        const fresh = new globalThis.BitcoinReplayRoom(history, {clock:() => wallNow / 1000, duration});
        await db.prepare('INSERT OR IGNORE INTO rooms (id, version, updated, snapshot) VALUES (?, ?, ?, ?)')
          .bind(ROOM, 1, wallNow, JSON.stringify(fresh.save())).run();
        continue;
      }
      const saved = JSON.parse(row.snapshot);
      const active = saved.phase === 'trading' || saved.phase === 'network' && row.updated < saved.networkStarted * 1000 + 60000;
      const tick = Math.floor(wallNow / TICK_MS) * TICK_MS;
      const needsTick = active && tick > row.updated;
      const mutation = !['state', 'audit'].includes(path);
      const now = mutation ? Math.max(wallNow, row.updated) : needsTick ? tick : row.updated;
      const engine = new globalThis.BitcoinReplayRoom(history, {saved, clock:() => now / 1000, duration});
      let state = engine.request('state', null, key, false, PUBLIC_URL);
      if (mutation && body.roundId !== engine.roundId)
        fail('The class started a new round. Please check the room and try again.', 409);

      if (path === 'join') {
        state = engine.request('join', {name:body.name}, key, false, PUBLIC_URL);
      } else if (path === 'trade') {
        if (typeof body.orderId !== 'string' || !body.orderId) fail('Missing trade reference. Refresh and try again.');
        state = engine.request('trade', body, key, false, PUBLIC_URL);
      } else if (path === 'control') {
        // A finished room must remain usable even after every old player leaves.
        if (body.action !== 'reset' && !engine.players.has(key))
          fail('Join the market before starting or changing a round.', 403);
        const allowed = {start:['lobby'], reset:['settled','network','discussion'],
          network:['settled'], discussion:['network','settled']};
        if (!allowed[body.action]?.includes(engine.phase))
          fail(engine.phase === 'trading' ? 'This round is running. A new round can start after it finishes.' :
            'The room has already moved on. Check the current screen.', 409);
        if (body.action === 'discussion' && engine.phase === 'network' && state.network.elapsed < state.network.duration)
          fail('The network replay is still running.', 409);
        state = engine.request('host', {action:body.action}, key, true, PUBLIC_URL);
      } else if (path === 'audit') {
        if (!engine.players.has(key)) fail('Join the market to download the round log.', 403);
      }

      const version = row.version + (needsTick || mutation ? 1 : 0);
      if (needsTick || mutation) {
        engine.revision = version;
        const result = await db.prepare('UPDATE rooms SET version = ?, updated = ?, snapshot = ? WHERE id = ? AND version = ?')
          .bind(version, now, JSON.stringify(engine.save()), ROOM, row.version).run();
        if (result.meta.changes !== 1) continue; // Another order won. Recheck against its committed book.
      }
      if (path === 'audit') return engine.auditReport(now / 1000);
      return {...state, revision:version, host:false, sharedRoom:true,
        canControl:Boolean(state.me), canReset:['settled','network','discussion'].includes(state.phase), serverTime:now};
    }
    fail('The room is busy. Please check your balance and try again.', 409);
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      const allowedOrigin = !origin || origin === 'https://eliang6033.github.io' || origin === url.origin ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      const headers = {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
        'Vary':'Origin', 'X-Content-Type-Options':'nosniff'};
      if (origin && allowedOrigin) headers['Access-Control-Allow-Origin'] = origin;
      const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
      if (!allowedOrigin) return json({error:'This origin is not allowed.', rejected:true}, 403);
      if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{...headers,
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type, Authorization', 'Access-Control-Max-Age':'3600'}});
      if (url.pathname === '/') return Response.redirect(PUBLIC_URL, 302);
      if (url.pathname === '/api/health') return json({ok:true, service:'Bitcoin Replay shared room', protocol:1});
      const path = url.pathname.replace(/^\/api\//, '');
      if (!['state','join','trade','control','audit'].includes(path)) return json({error:'Not found.', rejected:true},404);
      const mutation = ['join','trade','control'].includes(path);
      if (request.method !== (mutation ? 'POST' : 'GET')) return json({error:'Method not allowed.', rejected:true},405);
      try {
        const authorization = request.headers.get('Authorization');
        let key = '';
        if (authorization) {
          const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
          if (!match) fail('Invalid player identity.', 401);
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
          key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join('');
        }
        if ((mutation || path === 'audit') && !key) fail('Missing player identity.', 401);
        let body = {};
        if (mutation) {
          if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('Use a JSON request.',415);
          if (Number(request.headers.get('Content-Length')) > 4096) fail('Request too large.',413);
          const text = await request.text();
          if (text.length > 4096) fail('Request too large.',413);
          try { body = JSON.parse(text); } catch { fail('Invalid request.'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid request.');
        }
        // Primary reads plus a version condition prevent lost updates across Worker instances.
        const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
        return json(await roomRequest(db, path, body, key));
      } catch (error) {
        if (error.rejected) return json({error:error.message, rejected:true}, error.status || 400);
        console.error('Shared room request failed', error.message);
        return json({error:'The shared room is temporarily unavailable. Reconnecting…', rejected:false},503);
      }
    },
  };
}
