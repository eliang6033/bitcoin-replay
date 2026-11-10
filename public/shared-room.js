/* The same public room for players and spectators. All balances live on the service. */
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
  function connect() {
    const token = identity();
    const url = new URL(location.href);
    // Old host and room links lead to this same classroom, without claiming a role.
    url.searchParams.delete('host');
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    let roundId, latestRevision = -1;
    return {
      async request(path, body) {
        const headers = {Authorization:'Bearer ' + token};
        const opts = {headers, cache:'no-store', signal:AbortSignal.timeout(10000)};
        if (body) {
          opts.method = 'POST';
          headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify({...body, roundId});
        }
        const response = await fetch(endpoint + '/api/' + (path === 'host' ? 'control' : path), opts);
        const data = await response.json();
        if (!response.ok) throw Object.assign(Error(data.error || 'Connection interrupted. Reconnecting…'), {rejected:data.rejected === true});
        if (data.roundId && Number.isSafeInteger(data.revision) && data.revision >= latestRevision) {
          roundId = data.roundId;
          latestRevision = data.revision;
        }
        return data;
      },
    };
  }
  globalThis.BitcoinSharedRoom = {connect};
})();
