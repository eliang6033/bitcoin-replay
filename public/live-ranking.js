/* Human players only: use the host's cash-out totals, never mark-to-last-price. */
(() => {
  'use strict';
  function rank(players) {
    const sorted = players.map(p => ({name: p.name, profit: BitcoinPracticeMoney.profit(p.points)}))
      .sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
    let previous, place;
    return sorted.map((p, i) => {
      if (p.profit !== previous) place = i + 1;
      previous = p.profit;
      return {...p, place};
    });
  }
  const boards = new WeakMap();
  function render(list, players, {roundId, elapsed = 0, me, settled = false}) {
    let board = boards.get(list);
    if (!board || board.roundId !== roundId) {
      list.replaceChildren();
      board = {roundId, rows:new Map(), order:''};
      boards.set(list, board);
    }
    const ranked = rank(players);
    const order = JSON.stringify(ranked.map(p => p.name));
    const changedOrder = order !== board.order;
    const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const positions = new Map();
    if (changedOrder && motion && list.getClientRects().length) {
      for (const [name, entry] of board.rows) positions.set(name, entry.row.getBoundingClientRect());
    }
    const present = new Set();
    for (const p of ranked) {
      present.add(p.name);
      let entry = board.rows.get(p.name);
      if (!entry) {
        const row = document.createElement('li');
        const place = document.createElement('span'), name = document.createElement('span');
        const movement = document.createElement('span'), profit = document.createElement('b');
        place.className = 'live-place'; name.className = 'live-name';
        movement.className = 'live-movement'; profit.className = 'live-profit';
        name.textContent = p.name;
        row.append(place, name, movement, profit);
        entry = {row, place, name, movement, profit, prior:null, movedAt:-Infinity};
        board.rows.set(p.name, entry);
      }
      const {row, place, name, movement, profit, prior} = entry;
      row.dataset.place = p.place;
      row.classList.toggle('is-me', p.name === me);
      name.title = p.name;
      place.textContent = (p.place <= 3 ? ['🥇','🥈','🥉'][p.place - 1] + ' ' : '') + p.place;
      place.setAttribute('aria-label', 'Place ' + p.place);
      if (prior && prior.place !== p.place) {
        const delta = prior.place - p.place;
        movement.textContent = (delta > 0 ? '↑ ' : '↓ ') + Math.abs(delta);
        movement.dataset.direction = delta > 0 ? 'up' : 'down';
        movement.setAttribute('aria-label', (delta > 0 ? 'Up ' : 'Down ') + Math.abs(delta) + ' places');
        entry.movedAt = elapsed;
      } else if (elapsed - entry.movedAt > 2 || settled) {
        movement.textContent = ''; movement.removeAttribute('aria-label');
      }
      profit.textContent = (p.profit > 0 ? '+' : p.profit < 0 ? '−' : '') + BitcoinPracticeMoney.formatDollars(Math.abs(p.profit));
      profit.dataset.sign = p.profit > 0 ? 'gain' : p.profit < 0 ? 'loss' : 'even';
      if (prior && prior.profit !== p.profit && motion) {
        profit.getAnimations().forEach(animation => animation.cancel());
        profit.animate([{backgroundColor:p.profit > prior.profit ? '#225343' : '#582d3a'}, {backgroundColor:'transparent'}], {duration:400});
      }
      entry.prior = p;
      if (changedOrder) list.append(row);
    }
    for (const [name, entry] of board.rows) if (!present.has(name)) {
      entry.row.remove(); board.rows.delete(name);
    }
    list.style.setProperty('--rank-rows', Math.max(1, Math.ceil(ranked.length / 2)));
    if (changedOrder && motion) {
      for (const [name, before] of positions) {
        const entry = board.rows.get(name);
        if (!entry) continue;
        entry.row.getAnimations().forEach(animation => animation.cancel());
        const after = entry.row.getBoundingClientRect();
        const x = before.left - after.left, y = before.top - after.top;
        if (x || y) entry.row.animate([{transform:`translate(${x}px,${y}px)`}, {transform:'translate(0,0)'}], {duration:240, easing:'ease-out'});
      }
    }
    board.order = order;
    return ranked;
  }
  globalThis.BitcoinLiveRanking = {rank, render};
})();
