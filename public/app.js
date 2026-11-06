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
  selectedSide = "up",
  percent = 25,
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
const quoteAllowance = 0.15;
function shape(tag, attrs, content) {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (content != null) e.textContent = content;
  return e;
}
let bitcoinPlotKey = "", ticketPlotKey = "";
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
function drawTicketTape(s) {
  const history = s.ticketHistory || [];
  const visible = s.phase === "trading";
  show("ticketTape", visible);
  if (!visible) return;
  const lower = selectedSide === "down";
  const series = lower ? history.filter(point => Number.isFinite(point.downPrice)) : history;
  const name = lower ? "At or below" : "Above";
  const field = lower ? "downPrice" : "price";
  const quote = lower ? s.quotes.buyDown : s.quotes.buyUp;
  label("tapeHeading", "One “" + name + "” share costs");
  $("ticketTape").classList.toggle("lower", lower);
  label("tapeQuote", practice(quote));
  show("tapePlot", series.length > 0);
  show("tapeRange", series.length > 0);
  if (!series.length) return;
  const end = Math.max(0, Math.floor(s.elapsed * 4) / 4, series[series.length - 1].second);
  const first = Math.max(0, end - 30, series[0].second);
  label("tapeRange", end >= 30 ? "Room bets · share price over the last 30s" : "Room bets · share price since the start");
  const key = [s.roundId, name, end, series.length, quote].join("/");
  if (ticketPlotKey === key) return;
  ticketPlotKey = key;
  // Anchor the visible window to the last actual quote at or before its left edge.
  let idx = series.length - 1;
  while (idx > 0 && series[idx].second > first) idx--;
  const x = second => 3 + (second - first) * 291 / Math.max(1, end - first);
  const y = price => 51 - price * 4.6;
  let path = `M 3 ${y(series[idx][field]).toFixed(2)}`;
  for (const point of series.slice(idx + 1)) {
    if (point.second <= first) continue;
    path += ` H ${x(point.second).toFixed(2)} V ${y(point[field]).toFixed(2)}`;
  }
  path += ` H ${x(end).toFixed(2)}`;
  const graph = $("ticketGraph");
  graph.replaceChildren(
    shape("path", {d: path, fill: "none", stroke: "currentColor", "stroke-width": 2.1, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke"}),
    shape("circle", {cx: x(end), cy: y(quote), r: 2.6, fill: "currentColor"})
  );
  graph.setAttribute("aria-label", `One “${name}” share costs ${practice(quote)} in practice cash. The line shows how the price for this prediction has changed.`);
}
function roomCount(s) {
  const students = num.format(s.players) + (s.players === 1 ? " student team" : " student teams");
  return s.npcCount ? students + " · " + s.npcCount + " simulated traders" : students;
}
const quantityControl = $("quantity");
const sizeButtons = Array.from(document.querySelectorAll("#sizing [data-size]"));
const shareLabel = quantity => quantity === 1 ? "share" : "shares";
const sideName = side => side === "up" ? "Above" : "At or below";
function orderPreview(action) {
  if (state.bulk) return state.bulk[selectedSide][action][percent];
  // Hosts running a previous release still quote purchases of 1–10 shares.
  const quantity = state.quoteTotals ? Number(quantityControl.value) : 1;
  const key = action + (selectedSide === "up" ? "Up" : "Down");
  return {quantity, total: state.quoteTotals?.[key]?.[quantity - 1] ?? state.quotes[key]};
}
function executionLimit(action, quote, quantity) {
  if (!state.npcCount) return quote;
  const allowance = quantity * quoteAllowance;
  if (action === "buy") {
    const budget = (state.me?.cash ?? 100) * (state.bulk ? percent / 100 : 1);
    return Math.min(budget, quantity * 10, quote + allowance);
  }
  return Math.max(0, quote - allowance);
}
function setOrders() {
  const s = state;
  if (!s || !s.me) return;
  if (!s.quoteTotals) quantityControl.value = "1";
  quantityControl.disabled = busy || !s.quoteTotals;
  show("sizing", Boolean(s.bulk));
  show("legacySize", !s.bulk);
  show("sizeInfo", Boolean(s.bulk));
  for (const button of sizeButtons) {
    button.setAttribute("aria-pressed", Number(button.dataset.size) === percent);
    button.disabled = busy;
  }
  const name = sideName(selectedSide);
  const owned = s.me[selectedSide];
  label("owned", `You hold ${owned} “${name}” ${shareLabel(owned)}`);
  for (const side of ["up", "down"]) {
    const pick = $(side === "up" ? "pickUp" : "pickDown");
    pick.setAttribute("aria-pressed", side === selectedSide);
    pick.disabled = busy;
  }
  for (const action of ["buy", "sell"]) {
    const {quantity, total} = orderPreview(action);
    const buying = action === "buy";
    const canFill = quantity > 0 && (buying ? total <= s.me.cash : quantity <= owned);
    const verb = buying ? "Place bet" : "Cash out";
    const cost = (buying ? "Pay ≈ " : "Get ≈ ") + practice(total);
    const unavailable = buying ? "Not enough cash" : owned ? "Choose a larger size" : "No shares yet";
    label(action + "Price", canFill ? cost : unavailable);
    $(action).setAttribute("aria-label", canFill
      ? `${verb}, ${quantity} “${name}” ${shareLabel(quantity)}. ${cost}.`
      : verb + ". " + unavailable);
    $(action).title = canFill ? `${quantity} ${shareLabel(quantity)} · ${buying ? "Maximum cost" : "Minimum return"} ${practice(executionLimit(action, total, quantity))}` : "";
    $(action).disabled = busy || s.phase !== "trading" || !canFill;
  }
  const all = s.bulk?.cashOut;
  show("cashOutAll", Boolean(all?.quantity) && s.phase === "trading");
  if (all?.quantity) {
    label("cashOutAll", "Cash out everything ≈ " + practice(all.total));
    $("cashOutAll").disabled = busy;
    $("cashOutAll").setAttribute("aria-label", `Cash out everything, all ${all.quantity} ${shareLabel(all.quantity)} for about ${practice(all.total)}`);
    $("cashOutAll").title = "Sell all shares in both predictions for about " + practice(all.total);
  }
}
function paint(s) {
  const old = state;
  state = s;
  const net = ["network", "discussion"].includes(s.phase),
    done = Boolean(s.reveal),
    inGame = s.phase === "trading";
  if (old && old.roundId !== s.roundId) {
    selectedSide = "up";
    percent = 25;
    if (quantityControl) quantityControl.value = "1";
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
  drawTicketTape(s);
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
  show("prediction", !!s.me && !done);
  show("tradePanel", !!s.me && !done);
  label("seat", s.me ? s.me.name : done ? "Spectator" : "");
  show("positionReturn", Boolean(s.me && (s.me.up || s.me.down || s.me.cash !== 100)) && inGame);
  if (s.me) {
    label("wallet", practice(done ? s.me.points : s.me.cash));
    if (inGame) {
      const gain = (s.bulk ? s.me.cash + s.bulk.cashOut.total : s.me.points) - 100;
      label("gain", (gain < 0 ? "−" : "+") + practice(Math.abs(gain)));
      $("gain").classList.toggle("loss", gain < 0);
    }
  }
  label("ticketHeading", done ? "Final practice balance" : s.me ? "Your practice cash" : "Join the market");
  const note = !s.quoteTotals ? "This host supports one share at a time." :
    s.phase === "lobby" ? "You can trade when the host starts the clock." : "";
  label("orderNote", note);
  show("orderNote", Boolean(note));
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
  label("players", " · " + s.players + " " + (s.players === 1 ? "team" : "teams"));
  const rows = s.rankings.map((r) => {
    const li = document.createElement("li"),
      b = document.createElement("b");
    b.textContent = practice(r.points);
    li.append(document.createTextNode(r.name), b);
    return li;
  });
  $("ranking").replaceChildren(...rows);
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
        ? (body.action === "sellAll"
            ? "Cashed out all " + body.quantity + " " + shareLabel(body.quantity)
            : (body.action === "buy" ? "Bet on" : "Cashed out") + " “" + sideName(body.side) + "” · " + body.quantity + " " + shareLabel(body.quantity)) +
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
  submit("join", { name: $("team").value.trim() });
};
for (const side of ["up", "down"]) {
  $(side === "up" ? "pickUp" : "pickDown").onclick = () => {
    selectedSide = side;
    setOrders();
    drawTicketTape(state);
  };
}
quantityControl.onchange = setOrders;
for (const button of sizeButtons) {
  button.onclick = () => {
    percent = Number(button.dataset.size);
    setOrders();
  };
}
for (const action of ["buy", "sell"]) {
  $(action).onclick = () => {
    const {quantity, total} = orderPreview(action);
    submit("trade", {side: selectedSide, action, quantity, quoteLimit: executionLimit(action, total, quantity)});
  };
}
$("cashOutAll").onclick = () => {
  const {quantity, total} = state.bulk.cashOut;
  submit("trade", {side: "both", action: "sellAll", quantity, quoteLimit: executionLimit("sell", total, quantity)});
};
new ResizeObserver(() => {
  if (state) draw(state, ["network", "discussion"].includes(state.phase));
}).observe($("plot"));
$("restart").onclick = () => {
  if (confirm("End this practice round and clear team balances?"))
    submit("host", { action: "reset" });
};
$("hostAction").onclick = () => {
  const cmd = hostActions[state.phase]?.[1];
  if (cmd && (cmd !== "reset" || confirm("Clear all team balances and open a fresh round?")))
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
    "Join a team to get $100,000 in practice cash. Five classroom minutes replay four hours of real Bitcoin prices. The gold line shows Bitcoin’s price in US dollars. The dashed line marks where it started.",
    "Choose where Bitcoin will finish. Your pick has its own price, shown on the small chart. Each share you hold at the end pays $10,000 in practice cash if you are right and $0 if you are wrong. A tie goes to “At or below.”",
    "Place a bet with part of your cash. You can cash out shares while the clock is running. You and 20 simulated traders move the share prices together. You can spend only the cash you have.",
  ]);
$("invite").onclick = () =>
  modal(
    "Join this room",
    [
      online
        ? "Everyone scans the same code to join. Keep this host tab open during the game."
        : state.joinUrl.includes("127.0.0.1")
        ? "This preview is open on this computer. To invite phones, restart the classroom server in LAN mode as described in the project guide."
        : "Students on the same network can open this address on a phone or laptop and choose a team name.",
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
    ? "Connecting to the host. You’ll choose a team name when you arrive."
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
      show("ranks", true);
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
