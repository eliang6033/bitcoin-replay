"use strict";
const $ = (id) => document.getElementById(id);
const show = (id, yes) => {
  $(id).hidden = !yes;
};
const label = (id, value) => {
  if ($(id).textContent !== String(value)) $(id).textContent = value;
};
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const num = new Intl.NumberFormat("en-US");
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const practice = value => dollars.format(value * 1000);
const compactDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const timer = (t) =>
  String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(Math.floor(t % 60)).padStart(2, "0");
let state,
  orderPercent = 25,
  busy = false,
  pendingOrder = null,
  recentButton = null,
  sequence = 0,
  applied = 0;
const online = document.documentElement.dataset.hosting === "pages";
let session;
const hostActions = {
  lobby: ["Start 5-minute replay", "start"],
  settled: ["Replay the network", "network"],
  network: ["Open discussion", "discussion"],
  discussion: ["New class round", "reset"],
};
const svgNS = "http://www.w3.org/2000/svg";
function shape(tag, attrs, content) {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (content != null) e.textContent = content;
  return e;
}
let bitcoinPlotKey = "";
function draw(s, net) {
  const svg = $("graph");
  const width = Math.round(svg.clientWidth), height = Math.round(svg.clientHeight);
  if (!width || !height) return;
  const key = [s.roundId, s.phase, s.prices.length, width, height, net && Math.floor(s.network.elapsed)].join("/");
  if (bitcoinPlotKey === key) return;
  bitcoinPlotKey = key;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const fragment = document.createDocumentFragment();
  const left = width < 440 ? 18 : 26, right = width - left;
  const top = 18, bottom = height - 16;
  const span = bottom - top;
  if (net) {
    const x = minute => left + (right - left) * minute / 240;
    const maxTx = Math.max(5000, ...s.network.blocks.map(b => b.transactions));
    for (const b of s.network.blocks) {
      const h = span * b.transactions / maxTx;
      const bar = shape("rect", {x: x(b.minute) - 2, y: bottom - h, width: 5, height: h, rx: 2, fill: "#cbb6ff"});
      bar.append(shape("title", {}, `Block ${b.height} · ${num.format(b.transactions)} transactions`));
      fragment.append(bar);
    }
    const cursor = x(s.network.elapsed * 240 / s.network.duration);
    fragment.append(shape("line", {x1: cursor, x2: cursor, y1: top, y2: bottom, stroke: "#f2cc70", "stroke-width": 2}));
  } else if (s.phase !== "lobby") {
    const series = s.prices, base = s.startPrice, last = series[series.length - 1];
    const values = series.map(p => p.price);
    const low = Math.min(base, ...values), high = Math.max(base, ...values);
    const pad = Math.max((high - low) * .12, base * .00025);
    const y = value => bottom - (value - low + pad) * span / (high - low + 2 * pad);
    const plotRight = right - 5;
    const x = minute => left + (plotRight - left) * minute / Math.max(1, last.minute);
    const gradient = shape("linearGradient", {id: "btc-fill", x1: 0, y1: 0, x2: 0, y2: 1, gradientUnits: "objectBoundingBox"});
    gradient.append(shape("stop", {offset: 0, "stop-color": "#f6cb73", "stop-opacity": .19}),
      shape("stop", {offset: 1, "stop-color": "#f6cb73", "stop-opacity": 0}));
    const defs = shape("defs", {}); defs.append(gradient); fragment.append(defs);
    const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ");
    const cx = x(last.minute), cy = y(last.price);
    fragment.append(
      shape("path", {d: `${path} L${cx} ${bottom} L${left} ${bottom}Z`, fill: "url(#btc-fill)"}),
      shape("line", {x1: left, x2: plotRight, y1: y(base), y2: y(base), stroke: "#c5b3de", "stroke-dasharray": "6 5"}),
      shape("path", {d: path, fill: "none", stroke: "#fbd079", "stroke-width": 2.8, "stroke-linejoin": "round", "stroke-linecap": "round"}),
      shape("circle", {cx, cy, r: 6.5, fill: "#fbd079", "fill-opacity": .19}),
      shape("circle", {cx, cy, r: 3.4, fill: "#ffda8d"}),
      shape("text", {x: left + 5, y: y(base) - 7, fill: "#e2daec", "font-size": 12,
        "font-weight": 600, stroke: "#262134", "stroke-width": 4, "paint-order": "stroke",
        "stroke-linejoin": "round"}, "Start " + dollars.format(base))
    );
  }
  svg.replaceChildren(fragment);
}
let feedRound, feedCursor = 0, feedPaused = false, visibleFills = [], lastNpcSecond = -Infinity;
const compactFeed = window.matchMedia("(max-width: 1010px)");
// On phones the tape sits next to the trade buttons while a player is ordering.
const phoneFeed = window.matchMedia("(max-width: 790px)");
const chartFeedHome = $("tradeTape").parentNode;
function placeTradeFeed(s) {
  const home = phoneFeed.matches && s.me && s.phase === "trading" ? $("mobileTrades") : chartFeedHome;
  if ($("tradeTape").parentNode !== home) home.append($("tradeTape"));
}
function makeFillRow(fill, me) {
  const row = document.createElement("li");
  row.className = "fill-row";
  row.dataset.fillId = String(fill.id);
  row.dataset.actor = fill.actor;
  row.dataset.side = fill.side;
  row.dataset.action = fill.action;
  const who = document.createElement("span");
  who.className = "fill-who";
  who.textContent = fill.actor === "team" && fill.name === me?.name ? "You · " + fill.name :
    fill.actor === "team" && /^NPC \d+$/i.test(fill.name) ? "Player · " + fill.name : fill.name;
  who.title = who.textContent;
  const amount = document.createElement("b");
  amount.className = "fill-amount";
  amount.textContent = fill.actor === "npc" && fill.total >= 1000 ? compactDollars.format(fill.total * 1000) : practice(fill.total);
  amount.title = practice(fill.total);
  const detail = document.createElement("span");
  detail.className = "fill-what";
  detail.textContent = fill.action === "sellAll" ? "Sold all positions" :
    (fill.action === "buy" ? "Bought " : "Sold ") + sideName(fill.side);
  row.append(who, detail, amount);
  return row;
}
function drawTradeFeed(s) {
  placeTradeFeed(s);
  const active = s.phase === "trading" && Array.isArray(s.tradeFeed);
  show("tradeTape", active);
  const rows = $("fillRows");
  if (!active || feedRound !== s.roundId) {
    visibleFills = [];
    feedCursor = 0;
    lastNpcSecond = -Infinity;
    if (rows.childElementCount) rows.replaceChildren();
    feedRound = s.roundId;
    if (!active) return;
  }
  const latest = s.tradeFeed.at(-1)?.id || 0;
  if (feedPaused || document.hidden) {
    feedCursor = Math.max(feedCursor, latest);
    return;
  }

  // Skip a backlog after a tab sleeps or reconnects. Keep each already
  // displayed trade in the same DOM node so a poll never restarts its motion.
  const fresh = s.tradeFeed.filter(fill => fill.id > feedCursor && fill.second >= s.elapsed - 2);
  feedCursor = Math.max(feedCursor, latest);
  const candidates = visibleFills.filter(fill => fill.second >= s.elapsed - 8);
  for (const fill of fresh) {
    if (fill.actor === "npc") {
      if (fill.second - lastNpcSecond < 0.6) continue;
      lastNpcSecond = fill.second;
    }
    candidates.unshift(fill);
  }
  candidates.sort((a, b) => b.id - a.id);
  const slots = compactFeed.matches ? 2 : 4;
  const selected = candidates.slice(0, slots);
  // Rapid NPC orders must leave a recent classmate's fill readable.
  const team = candidates.find(fill => fill.actor === "team" && fill.name !== s.me?.name && fill.second >= s.elapsed - 5)
    || candidates.find(fill => fill.actor === "team" && fill.second >= s.elapsed - 5);
  if (team && !selected.includes(team)) selected[slots - 1] = team;
  visibleFills = selected;

  const activeRows = new Map(Array.from(rows.children, row => [Number(row.dataset.fillId), row]));
  const nodes = selected.map((fill, slot) => {
    const row = activeRows.get(fill.id) || makeFillRow(fill, s.me);
    activeRows.delete(fill.id);
    row.style.setProperty("--slot", slot);
    row.style.setProperty("--intensity", Math.max(.66, 1 - slot * .09 - .04 * Math.max(0, s.elapsed - fill.second - 3)));
    return row;
  });
  for (const removed of activeRows.values()) removed.remove();
  // Normally a new order only inserts one node before the previous newest.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const next = nodes[i + 1] || null;
    if (nodes[i].parentNode !== rows || nodes[i].nextSibling !== next) rows.insertBefore(nodes[i], next);
  }
  show("feedEmpty", !selected.length);
}
$("toggleTradeFeed").onclick = () => {
  feedPaused = !feedPaused;
  label("toggleTradeFeed", feedPaused ? "▶" : "Ⅱ");
  const instruction = feedPaused ? "Resume room trades" : "Pause room trades";
  $("toggleTradeFeed").setAttribute("aria-label", instruction);
  $("toggleTradeFeed").title = instruction;
  $("tradeTape").classList.toggle("paused", feedPaused);
  label("feedEmpty", feedPaused ? "Room trades paused" : "Waiting for trades…");
  if (!feedPaused && state) drawTradeFeed(state);
};
function roomCount(s) {
  const students = num.format(s.players) + (s.players === 1 ? " player" : " players");
  return s.npcCount ? students + " · " + s.npcCount + " simulated traders" : students;
}
const sizeButtons = Array.from(document.querySelectorAll("[data-percent]"));
const sideName = side => side === "up" ? "Up" : "Down";
function updateOutcomeRows(s) {
  const up = Math.min(100, Math.max(0, s.upPrice * 10));
  const upTenths = Math.round(up * 10);
  for (const side of ["up", "down"]) {
    const name = sideName(side);
    const chance = side === "up" ? up : 100 - up;
    const percentage = chance < 0.1 ? "<0.1%" : chance > 99.9 ? ">99.9%" :
      ((side === "up" ? upTenths : 1000 - upTenths) / 10).toFixed(1) + "%";
    const holders = s.support?.[side];
    label("odds" + name, percentage);
    $("bar" + name).style.width = chance + "%";
    label("holders" + name, Number.isInteger(holders) ? holders + (holders === 1 ? " player" : " players") : "Unavailable");
  }
}
function orderNotice(status) {
  $("notice").dataset.kind = status?.kind || "";
  label("noticeTitle", status?.headline || "");
  label("noticeDetail", status?.details || "");
  show("notice", Boolean(status));
}
function tradeHistory(s) {
  show("myTrades", Boolean(s.me));
  label("tradeCount", s.myTrades?.length || 0);
  if (!$("myTrades").open) return;
  label("historyNote", s.auditComplete === false ? "Earlier trades from the old version may be missing." :
    "Confirmed trades only. Received money is sale proceeds, not profit.");
  const rows = (s.myTrades || []).slice().reverse().map(fill => {
    const row = document.createElement("li"), title = document.createElement("b"), detail = document.createElement("small");
    title.textContent = timer(fill.second) + " · " + (fill.action === "buy" ? "Bought " : "Sold ") + (fill.side === "both" ? "both bets" : sideName(fill.side)) +
      " · " + (fill.action === "buy" ? "Paid " : "Received ") + practice(fill.total);
    detail.textContent = (fill.cashAfter == null ? "" : "Cash after trade: " + practice(fill.cashAfter) + " · ") +
      num.format(Number(fill.quantity.toFixed(4))) + " shares";
    row.append(title, detail); return row;
  });
  $("myTradeList").replaceChildren(...rows);
}
function setOrders() {
  const s = state;
  if (!s?.me) return;
  const supportsPercentages = Boolean(s.bulk?.up.fractions);
  const trading = s.phase === "trading";
  for (const button of sizeButtons) {
    button.setAttribute("aria-pressed", Number(button.dataset.percent) === orderPercent);
    button.disabled = busy || !supportsPercentages;
  }
  for (const side of ["up", "down"]) {
    const name = sideName(side);
    const quotes = s.bulk?.[side];
    const buy = quotes?.fractions?.[orderPercent].buy;
    const sell = quotes?.fractions?.[orderPercent].sell;
    const canBuy = buy?.amount > 0;
    const canSell = sell?.quantity > 0;
    label("cost" + name, canBuy ? "Pay " + practice(buy.amount) : s.me.cash > 0 ? "Waiting to start" : "No cash to spend");
    label("return" + name, canSell ? "Get ≈ " + practice(sell.total) : "No " + name + " held");
    $("buy" + name).disabled = busy || !trading || !canBuy;
    $("sell" + name).disabled = busy || !trading || !canSell;
    for (const action of ["buy", "sell"]) {
      const id = action + name, button = $(id);
      const waiting = pendingOrder?.button === id;
      button.dataset.pending = String(waiting);
      button.dataset.confirmed = String(recentButton === id);
      button.setAttribute("aria-busy", String(waiting));
      label(id + "Label", waiting ? (action === "buy" ? "Buying…" : "Selling…") :
        (recentButton === id ? "✓ " : "") + (action === "buy" ? "Buy " : "Sell ") + name);
    }
    $("buy" + name).title = "Use " + orderPercent + "% of your cash to buy " + name;
    $("sell" + name).title = "Sell " + orderPercent + "% of your " + name + " holdings";
    const held = s.me[side] > 0;
    show("holding" + name, held);
    if (held) label("value" + name, practice(quotes?.exit?.all.total ?? 0));
  }
  const all = s.bulk?.cashOut;
  show("positions", Boolean(s.me.up || s.me.down));
  show("cashOutAll", Boolean(all?.quantity) && Boolean(s.me.up && s.me.down));
  if (all?.quantity) {
    label("cashOutAll", "Sell both bets ≈ " + practice(all.total));
    $("cashOutAll").disabled = busy || !trading;
  }
  const note = s.phase === "lobby" ? "Buying opens when a player starts the replay." :
    trading && !supportsPercentages ? "Refresh this page to load the current trading controls." : "";
  label("orderNote", note);
  show("orderNote", Boolean(note));
}
let finalRankRound;
let watchingRanks = false;
function updateLiveBoard(s) {
  const allowed = !['network', 'discussion'].includes(s.phase);
  if (!allowed) watchingRanks = false;
  document.body.classList.toggle('watching-ranks', watchingRanks);
  show('liveBoard', watchingRanks);
  show('viewLiveNav', allowed && !watchingRanks);
  show('spectatorChoice', allowed && !s.me);
  if (!watchingRanks) return;
  const done = Boolean(s.reveal);
  label('liveRankHeading', done ? 'Final leaderboard' : 'Live leaderboard');
  $('liveRanking').setAttribute('aria-label', (done ? 'Final' : 'Live') + ' player rankings by profit');
  label('liveBadge', done ? '● FINAL' : s.phase === 'lobby' ? '● WAITING TO START' : '● LIVE');
  label('liveClock', done ? 'FINISHED' : timer(s.remaining));
  label('livePlayerCount', s.players + (s.players === 1 ? ' player' : ' players'));
  label('liveOdds', done ? sideName(s.reveal.winner) + ' wins' :
    'Up ' + (s.upPrice * 10).toFixed(1) + '% · Down ' + (s.downPrice * 10).toFixed(1) + '%');
  label('liveRankNote', done ? 'Final profit / loss after winning bets pay out.' :
    'Profit / loss includes cash and what your bets could sell for now. It can change until the finish.');
  show('liveEmpty', !s.rankings.length);
  BitcoinLiveRanking.render($('liveRanking'), s.rankings, {roundId:s.roundId, elapsed:s.elapsed, me:s.me?.name, settled:done});
}
function openLiveBoard() {
  if (!state) return;
  watchingRanks = true;
  updateLiveBoard(state);
  $('liveBoard').scrollIntoView({block:'start'});
  $('closeLive').focus({preventScroll:true});
}
$('viewLive').onclick = openLiveBoard;
$('viewLiveNav').onclick = openLiveBoard;
$('closeLive').onclick = () => {
  watchingRanks = false;
  if (state) { updateLiveBoard(state); draw(state, ['network','discussion'].includes(state.phase)); }
};
function drawStandings(s) {
  const settled = Boolean(s.reveal);
  show("ranks", !settled);
  show("leaderboard", settled);
  const count = s.players + (s.players === 1 ? " player" : " players");
  if (!settled) {
    finalRankRound = null;
    label("players", " · " + count);
    if (!$("ranks").open) return;
    $("ranking").replaceChildren(...s.rankings.map(player => {
      const li = document.createElement("li"), value = document.createElement("b");
      value.textContent = practice(player.points);
      li.append(document.createTextNode(player.name), value);
      return li;
    }));
    return;
  }
  // Show the standings immediately after settlement, and keep the host's
  // network replay and discussion in view during the following stages.
  const before = s.phase === "settled" ? document.querySelector(".layout") : $("ranks");
  if ($("leaderboard").nextElementSibling !== before) before.before($("leaderboard"));
  if (finalRankRound === s.roundId) return;
  finalRankRound = s.roundId;
  const players = BitcoinLiveRanking.rank(s.rankings);
  label("finalPlayerCount", count);
  show("rankingEmpty", players.length === 0);
  let priorProfit, place;
  const rows = players.map((player, i) => {
    if (player.profit !== priorProfit) place = i + 1;
    priorProfit = player.profit;
    const row = document.createElement("li");
    row.dataset.rank = place;
    const rank = document.createElement("span");
    rank.className = "final-rank";
    rank.textContent = "#" + place;
    if (place <= 3) {
      const cup = shape("svg", {viewBox: "0 0 24 24", class: "rank-trophy", "aria-hidden": "true", fill: "currentColor"});
      cup.append(shape("path", {d: "M6.5 3h11v2H21v2c0 3.4-1.7 5.1-4.7 5.5a6.3 6.3 0 0 1-3.2 2.8V18l3 1v2H8v-2l3-1v-2.7a6.3 6.3 0 0 1-3.3-2.8C4.7 12.1 3 10.4 3 7V5h3.5V3Zm0 4H5c0 1.8.7 2.9 2 3.4C6.7 9.3 6.5 8.2 6.5 7Zm11 0c0 1.2-.2 2.3-.5 3.4 1.3-.5 2-1.6 2-3.4h-1.5Z"}));
      rank.prepend(cup);
    }
    const name = document.createElement("span");
    name.className = "final-name";
    name.textContent = player.name;
    const amount = document.createElement("b");
    amount.className = "final-profit" + (player.profit < 0 ? " loss" : player.profit > 0 ? " gain" : "");
    amount.textContent = (player.profit > 0 ? "+" : player.profit < 0 ? "−" : "") + dollars.format(Math.abs(player.profit));
    row.append(rank, name, amount);
    return row;
  });
  $("finalRanking").replaceChildren(...rows);
}
function paint(s) {
  const old = state;
  state = s;
  const net = ["network", "discussion"].includes(s.phase),
    done = Boolean(s.reveal);
  if (old && old.roundId !== s.roundId) {
    orderPercent = 25;
    orderNotice(null);
    recentButton = null;
    $("ranks").open = false;
  }
  label(
    "headline",
    net ? "Behind the price." : done ? "The market has closed." : "Will Bitcoin finish higher?",
  );
  label(
    "intro",
    net
      ? "Watch blocks from the same four historical hours, then consider who lives alongside mining infrastructure."
      : done
        ? "The historical window is open. Compare your choices before viewing the network replay."
        : "Watch four hours of real Bitcoin prices in five minutes. Make your prediction with $100,000 in practice cash.",
  );
  label(
    "era",
    done
      ? new Date(s.reveal.startUtc).toLocaleDateString("en-US", {
          timeZone: "UTC",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "Mid-May 2021",
  );
  label("price", net ? num.format(s.network.blocks.length) + " blocks" : dollars.format(s.lastPrice));
  label("assetLabel", net ? "Bitcoin network" : "Historical Bitcoin price");
  show("currency", !net);
  const diff = s.lastPrice - s.startPrice;
  const distance = Math.abs(diff) < 1 ? "Less than $1" : dollars.format(Math.abs(diff));
  label("priceDelta", net
    ? num.format(s.network.txCount) + " transactions"
    : diff ? `${distance} ${diff < 0 ? "below" : "above"} the start` : "At the starting price");
  label("clockTitle", net ? "Network replay" : "Time left");
  label("clock", net ? timer(Math.ceil(s.network.duration - s.network.elapsed)) : timer(s.remaining));
  $("graph").setAttribute("aria-label", net
    ? "Recorded blocks and transactions during the network replay"
    : `Bitcoin started at ${usd.format(s.startPrice)} and is now ${usd.format(s.lastPrice)}.`);
  label("openLabel", net ? "0 hours" : "Start");
  label("endLabel", net ? "4 hours" : done ? "Finish" : "Now");
  label("baselineLabel", "Taller bar = more transactions");
  show("baselineLabel", net);
  draw(s, net);
  drawTradeFeed(s);
  label("traderCount", roomCount(s));
  show("lobbyArt", s.phase === "lobby");
  show("hostbar", s.sharedRoom || s.host);
  label("hostLabel", s.sharedRoom ? "Classroom" : "Host controls");
  show("marketUpdate", Boolean(s.host && s.currentMarketRules === false));
  const showLobbyInvite = (s.sharedRoom || s.host) && s.phase === "lobby" && scannable(s.joinUrl);
  $("hostbar").classList.toggle("scan-lobby", showLobbyInvite);
  show("lobbyInvite", showLobbyInvite);
  show("scanInstructions", showLobbyInvite);
  show("hostLabel", !showLobbyInvite);
  if (showLobbyInvite && $("lobbyInvite").dataset.url !== s.joinUrl) {
    const { image, download } = inviteCode(s.joinUrl);
    $("lobbyInvite").replaceChildren(image, download);
    $("lobbyInvite").dataset.url = s.joinUrl;
  }
  label("invite", showLobbyInvite ? "Share invite link" : "Class QR code");
  show("restart", s.sharedRoom ? s.canReset && s.phase !== "discussion" : s.host && s.phase !== "lobby" && s.phase !== "discussion");
  const command = hostActions[s.phase];
  show("hostAction", !!command);
  if (command) {
    label("hostAction", command[0]);
    $("hostAction").disabled =
      busy || (s.sharedRoom && !(command[1] === "reset" ? s.canReset : s.canControl)) || (s.phase === "network" && s.network.elapsed < s.network.duration);
    $("hostAction").title = s.sharedRoom && !s.canControl && command[1] !== "reset" ? "Join the market to use this control" : "";
  }
  label(
    "hostHint",
    s.phase === "network" ? "Same window · 60-second replay" :
      roomCount(s) + (s.sharedRoom && s.phase === "lobby" ? (s.me ? " · Any player can start when everyone is ready" : " · Join to play, or watch the leaderboard") : ""),
  );
  show("joinForm", !s.me && !done);
  show("walletPanel", !!s.me);
  show("cashDetail", !done);
  show("prediction", !done);
  if (!done) updateOutcomeRows(s);
  show("tradePanel", !!s.me && !done);
  label("seat", s.me ? s.me.name : done ? "Spectator" : "");
  show("positionReturn", Boolean(s.me));
  if (s.me) {
    const value = done ? s.me.points : s.bulk ? s.me.cash + s.bulk.cashOut.total : s.me.points;
    const gain = Math.round(value * 1000) - 100000;
    label("wallet", practice(value));
    label("gain", (gain < 0 ? "−" : gain > 0 ? "+" : "") + dollars.format(Math.abs(gain)));
    $("gain").classList.toggle("loss", gain < 0);
    label("availableCash", practice(s.me.cash));
    label("worthLabel", done ? "Final total" : "Total value · cash + bets");
    label("gainLabel", done ? "Your final profit / loss" : "Your profit / loss");
  }
  label("ticketHeading", s.me ? "Your money" : done ? "Results" : "Join the market");
  show("limitInfo", Boolean(s.npcCount));
  setOrders();
  show("result", done);
  show("network", net);
  show("discussion", s.phase === "discussion");
  if (done) {
    $("priceSource").href = s.reveal.source;
    label("winner", "“" + sideName(s.reveal.winner) + "” wins · $10,000 per share");
    const begin = s.reveal.startUtc,
      end = s.reveal.endUtc;
    label(
      "dates",
      begin.slice(0, 10) +
        " · " +
        begin.slice(11, 16) +
        "–" +
        end.slice(11, 16) +
        " UTC · " +
        usd.format(s.startPrice) +
        " → " +
        usd.format(s.lastPrice),
    );
    label("score", s.me ? practice(s.me.points) : "—");
  }
  if (net) {
    label("blocks", s.network.blocks.length);
    label("txs", num.format(s.network.txCount));
    const items = s.network.blocks.map((b) => {
      const a = document.createElement("a");
      a.href = "https://blockstream.info/block/" + b.id;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.title = "Block " + b.height + " · " + num.format(b.transactions) + " transactions";
      a.setAttribute("aria-label", a.title);
      a.append(document.createElement("i"));
      return a;
    });
    const track = $("blocktrack");
    if (track.childElementCount !== items.length) track.replaceChildren(...items);
    label(
      "netCaption",
      items.length
        ? "Select a block to inspect its public record."
        : "Waiting for the first recorded block.",
    );
  }
  if (s.phase === "discussion" && old?.phase === "network")
    $("discussion").scrollIntoView({ block: "start" });
  drawStandings(s);
  updateLiveBoard(s);
  tradeHistory(s);
  show("settlementNote", Boolean(done && s.me));
  if (done && s.me) {
    const loser = s.reveal.winner === "up" ? "down" : "up";
    label("settlementNote", sideName(s.reveal.winner) + " won. " +
      (s.me[loser] > 0 ? "Your remaining " + sideName(loser) + " bets paid $0. " : "") +
      "Final total = cash " + practice(s.me.cash) + " + winning bets " + practice(s.me[s.reveal.winner] * 10) + ".");
  }
  const noticeHome = s.phase === "trading" ? $("tradeNoticeHome") : $("myTrades").parentNode;
  if ($("notice").parentNode !== noticeHome) {
    if (s.phase === "trading") noticeHome.append($("notice"));
    else noticeHome.insertBefore($("notice"), $("myTrades"));
  }
  show("downloadLog", Boolean(s.host || s.sharedRoom && s.me));
}
async function call(path, body) {
  const id = ++sequence;
  const data = online ? await session.request(path, body) : await localRequest(path, body);
  if (BitcoinTradeStatus.shouldApply(state, data, id, applied)) {
    applied = Math.max(applied, id);
    paint(data);
  }
  show("status", false);
  return data;
}
async function localRequest(path, body) {
  const opts = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    : {};
  const res = await fetch("/api/" + path, {
    ...opts,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(Error(data.error || "Room unavailable."), { rejected: true });
  return data;
}
async function submit(path, body) {
  if (busy) return;
  busy = true;
  recentButton = null;
  const isTrade = path === "trade";
  if (isTrade) {
    body = { ...body, orderId: crypto.randomUUID() };
    const buying = ["buy", "buyCash"].includes(body.action);
    pendingOrder = { button: body.side === "both" ? "cashOutAll" : (buying ? "buy" : "sell") + sideName(body.side) };
    orderNotice({ kind: "pending", headline: buying ? "Buying " + sideName(body.side) + "…" : "Selling " + (body.side === "both" ? "both bets" : sideName(body.side)) + "…",
      details: "Confirming your order. Please do not click again." });
  }
  setOrders();
  try {
    const updated = await call(path, body);
    if (isTrade) {
      const fill = updated.tradeReceipt || updated.myTrades?.find(f => f.orderId === body.orderId);
      orderNotice(fill ? BitcoinTradeStatus.receipt(fill) : { kind: "success", headline: "Order accepted", details: "Check your updated balance and holdings." });
      recentButton = pendingOrder.button;
    }
  } catch (e) {
    if (isTrade) {
      // A missing acknowledgement is not proof of rejection. Look for the exact
      // reference after reconnecting, and never silently resend the order.
      let confirmed;
      try { confirmed = (await call("state")).myTrades?.find(f => f.orderId === body.orderId); } catch { }
      orderNotice(confirmed ? BitcoinTradeStatus.receipt(confirmed) : BitcoinTradeStatus.failure(e));
      if (confirmed) recentButton = pendingOrder.button;
    } else {
      label("status", e.message);
      show("status", true);
    }
  } finally {
    busy = false;
    pendingOrder = null;
    if (state) paint(state);
  }
}
async function refresh() {
  if (!busy)
    try {
      await call("state");
    } catch (error) {
      label("status", online ? error.message : "Connection interrupted. Reconnecting to the classroom…");
      show("status", true);
    }
  setTimeout(refresh, state?.phase === "trading" && state.npcCount ? 280 : 1000);
}
$("myTrades").ontoggle = () => { if (state) tradeHistory(state); };
$("downloadLog").onclick = async () => {
  try {
    const report = online ? await session.request("audit") : await localRequest("audit");
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: "application/json"}));
    link.href = url; link.download = "bitcoin-replay-" + report.roundId + ".json";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) { label("status", error.message); show("status", true); }
};
$("joinForm").onsubmit = (e) => {
  e.preventDefault();
  submit("join", { name: $("playerName").value.trim() });
};
for (const button of sizeButtons) {
  button.onclick = () => {
    if (busy) return;
    orderPercent = Number(button.dataset.percent);
    setOrders();
  };
}
for (const side of ["up", "down"]) {
  $("buy" + sideName(side)).onclick = () => {
    if (busy || $("buy" + sideName(side)).disabled) return;
    const quote = state.bulk[side].fractions[orderPercent].buy;
    submit("trade", { side, action: "buyCash", amount: quote.amount, minQuantity: quote.quantity * 0.97 });
  };
  $("sell" + sideName(side)).onclick = () => {
    if (busy || $("sell" + sideName(side)).disabled) return;
    const {quantity, total} = state.bulk[side].fractions[orderPercent].sell;
    submit("trade", { side, action: "sell", quantity, quoteLimit: Math.max(0, total * 0.97) });
  };
}
$("cashOutAll").onclick = () => {
  if (busy || $("cashOutAll").disabled) return;
  const {quantity, total} = state.bulk.cashOut;
  submit("trade", {side: "both", action: "sellAll", quantity, quoteLimit: Math.max(0, total * 0.97)});
};
new ResizeObserver(() => {
  if (state) draw(state, ["network", "discussion"].includes(state.phase));
}).observe($("plot"));
$("restart").onclick = () => {
  if (confirm(state.sharedRoom ? "Open a new round for everyone and clear the previous balances?" : "End this practice round and clear player balances?"))
    submit("host", { action: "reset" });
};
$("hostAction").onclick = () => {
  const cmd = hostActions[state.phase]?.[1];
  if (cmd && (cmd !== "reset" || confirm("Clear all player balances and open a fresh round?")))
    submit("host", { action: cmd });
};
function scannable(url) {
  return !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
}
function inviteCode(url) {
  const download = BitcoinRoomQR.downloadLink(BitcoinRoomQR.create(url));
  const image = document.createElement("img");
  image.className = "room-qr";
  image.alt = "Scan to join this Bitcoin Replay room";
  image.src = download.href;
  return { image, download };
}
function modal(title, paragraphs, code) {
  const box = $("dialogText"),
    h = document.createElement("h2");
  h.textContent = title;
  box.replaceChildren(h);
  for (const t of paragraphs) {
    const p = document.createElement("p");
    p.textContent = t;
    box.append(p);
  }
  if (code) {
    let download;
    if (scannable(code)) {
      const invite = inviteCode(code);
      download = invite.download;
      box.append(invite.image);
    }
    const input = document.createElement("input");
    input.value = code;
    input.readOnly = true;
    input.setAttribute("aria-label", "Student invite link");
    const copy = document.createElement("button");
    copy.textContent = "Copy invite link";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = "Copied";
      } catch {
        input.focus();
        input.select();
        copy.textContent = "Select and copy the link";
      }
    };
    const actions = document.createElement("div");
    actions.className = "invite-actions";
    if (download) actions.append(download);
    actions.append(copy);
    box.append(input, actions);
  }
  $("dialog").showModal();
}
$("guide").onclick = () =>
  modal("How to play", [
    "Enter your name or nickname to get $100,000 in practice cash. Five classroom minutes replay four hours of real Bitcoin prices. The gold line shows Bitcoin’s price in US dollars. The dashed line marks where it started.",
    "Pick Up or Down. Market chance follows the room’s share prices. Player counts show how many classmates own that outcome. If you hold both, you count on both sides.",
    "Choose a percentage and tap Buy Up, Buy Down, Sell Up, or Sell Down. Buying uses that percentage of your spendable cash. Selling closes that percentage of your holdings on the chosen side. You can hold both sides. Your total includes unspent cash plus the money you could get by selling your bets. Profit or loss compares that total with your starting $100,000. At the finish, winning bets pay out and losing bets become worth $0. A tie goes to Down.",
  ]);
$("invite").onclick = () =>
  modal(
    "Join this room",
    [
      online
        ? "Everyone uses this same link. Join with your name or watch the live leaderboard. The shared server keeps the room running when you close your tab."
        : state.joinUrl.includes("127.0.0.1")
        ? "This preview is open on this computer. To invite phones, restart the classroom server in LAN mode as described in the project guide."
        : "Students on the same network can open this address on a phone or laptop and enter their name or nickname.",
    ],
    state.joinUrl,
  );
$("close").onclick = () => $("dialog").close();

function startOnline() {
  show("joinForm", false);
  show("ranks", false);
  show("launcher", true);
  label("price", "Market lobby");
  label("priceDelta", "Everyone shares this room");
  label("ticketHeading", "Join the classroom");
  label("launchText", "Connecting to the shared room. Join the game or watch the live leaderboard.");
  const button = $("launchButton");
  const connect = async () => {
    if (button.disabled) return;
    button.disabled = true;
    label("launchButton", "Connecting…");
    show("status", false);
    try {
      if (!window.BitcoinSharedRoom) throw Error("The room software could not load. Reload this page to try again.");
      session = BitcoinSharedRoom.connect();
      await call("state");
      show("launcher", false);
      refresh();
    } catch (error) {
      label("status", error.message || "Could not connect to the shared room. Try again.");
      show("status", true);
      label("launchButton", "Reconnect to classroom");
      button.disabled = false;
    }
  };
  button.onclick = connect;
  connect();
}
if (online) startOnline();
else refresh();
