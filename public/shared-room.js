/* Independent cloud rooms. Players and spectators share the same invitation link. */
(() => {
  'use strict';
  const endpoint = 'https://bitcoin-replay-shared-room.grassylens.chatgpt.site';
  const identityKey = 'bitcoin-replay.shared.v1.player';
  let memoryToken;
  function identity() {
    if (memoryToken) return memoryToken;
    try { memoryToken = localStorage.getItem(identityKey); } catch {}
    if (!/^[a-f0-9]{64}$/.test(memoryToken || '')) {
      memoryToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
      try { localStorage.setItem(identityKey, memoryToken); } catch {}
    }
    return memoryToken;
  }
  const lastRoomKey = 'bitcoin-replay.shared.v1.lastRoom';
  const validCode = code => code === 'CLASSROOM' || /^[A-HJ-NP-Z2-9]{8}$/.test(code);
  const normalize = value => String(value || '').trim().replace(/[\s-]/g,'').toUpperCase();
  function entry() {
    const params = new URL(location.href).searchParams;
    let code = params.get('room') || params.get('host');
    if (/^[a-f0-9]{24}$/i.test(code || '')) code = 'CLASSROOM';
    code = normalize(code);
    return {code:validCode(code) ? code : null, invalid:Boolean(code && !validCode(code))};
  }
  function lastRoom() {
    try { const code = localStorage.getItem(lastRoomKey); return validCode(code) ? code : null; } catch { return null; }
  }
  async function send(path, body, code) {
    const headers = {Authorization:'Bearer ' + identity()};
    const opts = {headers, cache:'no-store', signal:AbortSignal.timeout(10000)};
    if (body) {
      opts.method = 'POST'; headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const response = await fetch(endpoint + '/api/' + path + (code ? '?room=' + encodeURIComponent(code) : ''), opts);
    let data;
    try { data = await response.json(); } catch { throw Error('Could not connect to the room. Please try again.'); }
    if (!response.ok) throw Object.assign(Error(data.error || 'Connection interrupted. Reconnecting…'), {rejected:data.rejected === true, status:response.status});
    return data;
  }
  let pendingCreation;
  async function create() {
    pendingCreation ||= crypto.randomUUID();
    try {
      const result = await send('create', {creationId:pendingCreation});
      pendingCreation = null;
      return result.roomCode;
    } catch (error) {
      if (error.rejected) pendingCreation = null;
      throw error;
    }
  }
  function connect(input) {
    const code = normalize(input);
    if (!validCode(code)) throw Object.assign(Error('Enter the eight-character room code from your friend.'), {invalidRoom:true});
    let roundId, latestRevision = -1, remembered = false;
    return {
      async request(path, body) {
        const data = await send(path === 'host' ? 'control' : path, body ? {...body,roundId} : null, code);
        if (data.roundId && Number.isSafeInteger(data.revision) && data.revision >= latestRevision) {
          roundId = data.roundId; latestRevision = data.revision;
          if (!remembered) {
            const url = new URL(location.href);
            url.search = ''; url.searchParams.set('room',code);
            history.replaceState(null,'',url);
            try { localStorage.setItem(lastRoomKey,code); } catch {}
            remembered = true;
          }
        }
        return data;
      },
    };
  }
  globalThis.BitcoinSharedRoom = {connect, create, entry, lastRoom, normalize};
})();
