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
const timer = (t) =>
  String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(Math.floor(t % 60)).padStart(2, "0");
let state,
  orderPercent = 25,
  busy = false,
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
  amount.textContent = practice(fill.total);
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
  const roundedUp = Math.round(up);
  for (const side of ["up", "down"]) {
    const name = sideName(side);
    const chance = side === "up" ? up : 100 - up;
    const percentage = chance < 1 ? "<1%" : chance > 99 ? ">99%" :
      (side === "up" ? roundedUp : 100 - roundedUp) + "%";
    const holders = s.support?.[side];
    label("odds" + name, percentage);
    $("bar" + name).style.width = chance + "%";
    label("holders" + name, Number.isInteger(holders) ? holders + (holders === 1 ? " player" : " players") : "Unavailable");
  }
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
    label("cost" + name, canBuy ? "Pay " + practice(buy.amount) : s.me.cash > 0 ? "Waiting for host" : "No cash to spend");
    label("return" + name, canSell ? "Get ≈ " + practice(sell.total) : "No " + name + " held");
    $("buy" + name).disabled = busy || !trading || !canBuy;
    $("sell" + name).disabled = busy || !trading || !canSell;
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
  const note = s.phase === "lobby" ? "Buying opens when the host starts the clock." :
    trading && !supportsPercentages ? "Ask the host to refresh their page to enable percentage orders." : "";
  label("orderNote", note);
  show("orderNote", Boolean(note));
}
let finalRankRound;
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
  const players = s.rankings.map(player => ({
    name: player.name,
    profit: Math.round(player.points * 1000) - 100000,
  })).sort((a, b) => b.profit - a.profit);
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
    label("notice", "");
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
  show("hostbar", s.host);
  const showLobbyInvite = s.host && s.phase === "lobby" && scannable(s.joinUrl);
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
  show("restart", s.host && s.phase !== "lobby" && s.phase !== "discussion");
  const command = hostActions[s.phase];
  show("hostAction", !!command);
  if (command) {
    label("hostAction", command[0]);
    $("hostAction").disabled =
      busy || (s.phase === "network" && s.network.elapsed < s.network.duration);
  }
  label(
    "hostHint",
    s.phase === "network" ? "Same window · 60-second replay" :
      roomCount(s),
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
}
async function call(path, body) {
  const id = ++sequence;
  const data = online ? await session.request(path, body) : await localRequest(path, body);
  if (id > applied) {
    applied = id;
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
  if (!res.ok) throw Error(data.error || "Room unavailable.");
  return data;
}
async function submit(path, body) {
  if (busy) return;
  busy = true;
  setOrders();
  try {
    const previousCash = state?.me?.cash;
    const updated = await call(path, body);
    label(
      "notice",
      path === "trade"
        ? (body.action === "sellAll" ? "Sold both bets" :
          body.action === "buyCash" || body.action === "buy" ? "Bought " + sideName(body.side) : "Sold " + sideName(body.side)) +
          " for " + practice(Math.abs(updated.me.cash - previousCash)) + "."
        : "",
    );
  } catch (e) {
    if (path === "trade") {
      // Refresh the quote and wallet after a rejection. Never resubmit an order.
      try { await call("state"); } catch { /* Keep the original order error visible. */ }
    }
    const message = e.message.startsWith("Another team traded")
      ? "The price changed too quickly. Check the new price and tap again."
      : e.message === "You need more points for this trade." ? "You need more practice cash for this bet."
      : e.message === "You can only sell tickets you own." ? "You can cash out only shares you own."
      : e.message;
    label("notice", message);
    if (path !== "trade") {
      label("status", message);
      show("status", true);
    }
  } finally {
    busy = false;
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
  if (confirm("End this practice round and clear player balances?"))
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
        ? "Everyone scans the same code to join. Keep this host tab open during the game."
        : state.joinUrl.includes("127.0.0.1")
        ? "This preview is open on this computer. To invite phones, restart the classroom server in LAN mode as described in the project guide."
        : "Students on the same network can open this address on a phone or laptop and enter their name or nickname.",
    ],
    state.joinUrl,
  );
$("close").onclick = () => $("dialog").close();

function startOnline() {
  const params = new URLSearchParams(location.search);
  const invited = params.get("room");
  const hostId = window.BitcoinClassroom?.currentHostId();
  const isReturningHost = hostId && (!params.has("host") || params.get("host") === hostId);
  show("joinForm", false);
  show("ranks", false);
  show("launcher", true);
  label("price", "Market lobby");
  label("priceDelta", "Waiting to start");
  label("ticketHeading", invited ? "Join this room" : "Play with friends");
  label("launchText", invited
    ? "Connecting to the host. Enter your name or nickname when you arrive."
    : "Create one room and invite everyone with the same link. Playing alone? You can join your own round.");
  const button = $("launchButton");
  const buttonName = invited ? "Connect to room" : isReturningHost ? "Reopen your room" : "Create a room";
  label("launchButton", buttonName);
  const connect = async () => {
    if (button.disabled) return;
    button.disabled = true;
    label("launchButton", invited ? "Joining room…" : "Opening room…");
    show("status", false);
    let connected;
    try {
      if (!window.BitcoinClassroom) throw Error("The room software could not load. Reload this page to try again.");
      connected = invited ? await BitcoinClassroom.join(invited) : await BitcoinClassroom.create();
      session = connected;
      await call("state");
      show("launcher", false);
      refresh();
    } catch (error) {
      if (connected) BitcoinClassroom.dispose();
      label("status", error.message || "Could not connect. Check the host tab and try again.");
      show("status", true);
      label("launchButton", buttonName);
      button.disabled = false;
    }
  };
  button.onclick = connect;
  if (invited || (params.has("host") && isReturningHost)) connect();
}
if (online) startOnline();
else refresh();
