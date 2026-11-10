const PUBLIC_URL = 'https://eliang6033.github.io/bitcoin-replay/';
const LEGACY_ROOM = 'classroom';
const codeFormat = /^(?:[1-9][0-9]{4}|[A-HJ-NP-Z2-9]{8})$/;
const roomLink = code => PUBLIC_URL + '?room=' + code;
const TICK_MS = 200;
const fail = (message, status = 400) => { throw Object.assign(Error(message), {status, rejected:true}); };

// Each room has its own durable row and compare-and-swap writes. No browser owns the clock.
// Replaying scheduled NPC events from the saved seed makes catch-up deterministic.
export function createService(history, {clock = () => Date.now(), duration = 300} = {}) {
  async function createRoom(db, body, key) {
    if (typeof body.creationId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.creationId)) fail('Invalid room creation request.');
    // The same explicit creation request can be retried after a lost reply.
    // This marker provides idempotency, not a presenter role or special controls.
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key + body.creationId)));
    const firstCode = new DataView(digest.buffer).getUint32(0) % 90000;
    const creationKey = Array.from(digest, byte => byte.toString(16).padStart(2,'0')).join('');
    const now = clock();
    const fresh = new globalThis.BitcoinReplayRoom(history, {clock:() => now / 1000, duration});
    // Never overwrite an occupied short code. Deterministic probing also keeps
    // a retried creation request attached to the same room after a collision.
    for (let attempt = 0; attempt < 32; attempt++) {
      const code = String(10000 + (firstCode + attempt) % 90000);
      await db.prepare('INSERT OR IGNORE INTO rooms (id, version, updated, snapshot) VALUES (?, ?, ?, ?)')
        .bind(code, 1, now, JSON.stringify({...fresh.save(), creationKey})).run();
      const row = await db.prepare('SELECT snapshot FROM rooms WHERE id = ?').bind(code).first();
      if (JSON.parse(row.snapshot).creationKey === creationKey) return {roomCode:code, joinUrl:roomLink(code)};
    }
    fail('Please create a room again.',409);
  }

  async function roomRequest(db, path, body, key, code) {
    const room = code === 'CLASSROOM' ? LEGACY_ROOM : code;
    const joinUrl = roomLink(code);
    for (let attempt = 0; attempt < 20; attempt++) {
      const wallNow = clock();
      let row = await db.prepare('SELECT version, updated, snapshot FROM rooms WHERE id = ?').bind(room).first();
      if (!row) {
        if (room !== LEGACY_ROOM) fail('Room not found. Check the code or ask for the room link.',404);
        const fresh = new globalThis.BitcoinReplayRoom(history, {clock:() => wallNow / 1000, duration});
        await db.prepare('INSERT OR IGNORE INTO rooms (id, version, updated, snapshot) VALUES (?, ?, ?, ?)')
          .bind(room, 1, wallNow, JSON.stringify(fresh.save())).run();
        continue;
      }
      const saved = JSON.parse(row.snapshot);
      const active = saved.phase === 'trading' || saved.phase === 'network' && row.updated < saved.networkStarted * 1000 + 60000;
      const tick = Math.floor(wallNow / TICK_MS) * TICK_MS;
      const needsTick = active && tick > row.updated;
      const mutation = !['state', 'audit'].includes(path);
      const now = mutation ? Math.max(wallNow, row.updated) : needsTick ? tick : row.updated;
      const engine = new globalThis.BitcoinReplayRoom(history, {saved, clock:() => now / 1000, duration});
      let state = engine.request('state', null, key, false, joinUrl);
      if (mutation && body.roundId !== engine.roundId)
        fail('The class started a new round. Please check the room and try again.', 409);

      if (path === 'join') {
        state = engine.request('join', {name:body.name}, key, false, joinUrl);
      } else if (path === 'trade') {
        if (typeof body.orderId !== 'string' || !body.orderId) fail('Missing trade reference. Refresh and try again.');
        state = engine.request('trade', body, key, false, joinUrl);
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
        state = engine.request('host', {action:body.action}, key, true, joinUrl);
      } else if (path === 'audit') {
        if (!engine.players.has(key)) fail('Join the market to download the round log.', 403);
      }

      const version = row.version + (needsTick || mutation ? 1 : 0);
      if (needsTick || mutation) {
        engine.revision = version;
        const result = await db.prepare('UPDATE rooms SET version = ?, updated = ?, snapshot = ? WHERE id = ? AND version = ?')
          .bind(version, now, JSON.stringify({...engine.save(), creationKey:saved.creationKey}), room, row.version).run();
        if (result.meta.changes !== 1) continue; // Another order won. Recheck against its committed book.
      }
      if (path === 'audit') return {...engine.auditReport(now / 1000), roomCode:code};
      return {...state, revision:version, host:false, sharedRoom:true, roomCode:code,
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
      if (url.pathname === '/api/health') return json({ok:true, service:'Bitcoin Replay rooms', protocol:2});
      const path = url.pathname.replace(/^\/api\//, '');
      if (!['create','state','join','trade','control','audit'].includes(path)) return json({error:'Not found.', rejected:true},404);
      const mutation = ['create','join','trade','control'].includes(path);
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
        if (path === 'create') return json(await createRoom(db, body, key));
        // Requests from already-open clients retain the original shared room.
        const code = url.searchParams.has('room') ? url.searchParams.get('room').trim().toUpperCase() : 'CLASSROOM';
        if (code !== 'CLASSROOM' && !codeFormat.test(code)) fail('Enter a five-digit room code.');
        return json(await roomRequest(db, path, body, key, code));
      } catch (error) {
        if (error.rejected) return json({error:error.message, rejected:true}, error.status || 400);
        console.error('Shared room request failed', error.message);
        return json({error:'The shared room is temporarily unavailable. Reconnecting…', rejected:false},503);
      }
    },
  };
}
