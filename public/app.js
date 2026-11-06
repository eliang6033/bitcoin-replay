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
const pts = (n) => Number(n).toFixed(2);
const timer = (t) =>
  String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(Math.floor(t % 60)).padStart(2, "0");
let state,
  action = "buy",
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
function draw(s, net) {
  const svg = $("graph"),
    fragment = document.createDocumentFragment();
  const left = 22,
    right = 633,
    top = 22,
    bottom = 228;
  const x = (m) => left + ((right - left) * m) / 240;
  const series = s.prices,
    base = s.startPrice;
  const lo = Math.min(base * 0.998, ...series.map((p) => p.price)),
    hi = Math.max(base * 1.002, ...series.map((p) => p.price));
  const y = (p) => bottom - ((bottom - top) * (p - lo)) / (hi - lo);
  for (let i = 0; i <= 4; i++) {
    const yy = top + ((bottom - top) * i) / 4;
    fragment.append(
      shape("line", {
        x1: left,
        x2: right,
        y1: yy,
        y2: yy,
        stroke: "#4c435a",
        "stroke-dasharray": "3 5",
      }),
    );
    if (!net)
      fragment.append(
        shape(
          "text",
          { x: right + 8, y: yy + 4, fill: "#b8b0c7", "font-family": "monospace", "font-size": 12 },
          Math.round(hi - ((hi - lo) * i) / 4).toLocaleString("en-US"),
        ),
      );
    fragment.append(
      shape("line", { x1: x(i * 60), x2: x(i * 60), y1: top, y2: bottom, stroke: "#3a3248" }),
    );
  }
  if (net) {
    const maxTx = Math.max(5000, ...s.network.blocks.map((b) => b.transactions));
    for (const b of s.network.blocks) {
      const bar = shape("rect", {
        x: x(b.minute) - 2,
        y: bottom - (180 * b.transactions) / maxTx,
        width: 5,
        height: (180 * b.transactions) / maxTx,
        rx: 2,
        fill: "#bba7f0",
      });
      bar.append(
        shape(
          "title",
          {},
          "Block " + b.height + " · " + num.format(b.transactions) + " transactions",
        ),
      );
      fragment.append(bar);
    }
    const cursor = x((s.network.elapsed * 240) / s.network.duration);
    fragment.append(
      shape("line", {
        x1: cursor,
        x2: cursor,
        y1: top,
        y2: bottom,
        stroke: "#f2cc70",
        "stroke-width": 2,
      }),
    );
  } else {
    fragment.append(
      shape("line", {
        x1: left,
        x2: right,
        y1: y(base),
        y2: y(base),
        stroke: "#c6b5e6",
        "stroke-dasharray": "6 5",
      }),
    );
    const path = series
      .map((p, i) => (i ? "L" : "M") + x(p.minute).toFixed(2) + " " + y(p.price).toFixed(2))
      .join(" ");
    const last = series[series.length - 1];
    fragment.append(
      shape("path", {
        d: path + " L" + x(last.minute) + " " + bottom + " L" + left + " " + bottom + " Z",
        fill: "#ac94eb",
        "fill-opacity": ".10",
      }),
      shape("path", {
        d: path,
        fill: "none",
        stroke: "#f7d16c",
        "stroke-width": 3,
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke",
      }),
      shape("circle", { cx: x(last.minute), cy: y(last.price), r: 4, fill: "#ffdf87" }),
    );
  }
  svg.replaceChildren(fragment);
}
function drawTicketTape(s) {
  const series = s.ticketHistory;
  const visible = Boolean(series?.length) && !["network", "discussion"].includes(s.phase);
  show("ticketTape", visible);
  if (!visible) return;

  const first = series[0].second;
  const end = Math.max(0, s.elapsed, series[series.length - 1].second);
  const quote = s.quotes.buyUp;
  const prices = series.map(point => point.price);
  const low = Math.max(0, Math.floor((Math.min(...prices) - 0.15) * 2) / 2);
  const high = Math.min(10, Math.ceil((Math.max(...prices) + 0.15) * 2) / 2);
  const x = time => 5 + (time - first) * 256 / Math.max(end - first, 1);
  const y = price => 66 - (price - low) * 54 / Math.max(high - low, 0.5);
  const fragment = document.createDocumentFragment();

  for (const tick of [low, high]) {
    fragment.append(
      shape("line", {x1: 5, x2: 264, y1: y(tick), y2: y(tick), stroke: "#b8cfc2", "stroke-dasharray": "2 4"}),
      shape("text", {x: 298, y: y(tick) + 3, "text-anchor": "end", fill: "#547160", "font-size": 10}, tick.toFixed(1)),
    );
  }
  if (first < 0 && end > 0) {
    fragment.append(shape("line", {x1: x(0), x2: x(0), y1: 6, y2: 70, stroke: "#91ab9c"}));
  }
  const preopen = series.filter(point => point.second <= 0);
  const live = series.filter(point => point.second > 0);
  function trace(points, lastTime, warmup) {
    if (!points.length) return;
    const start = points[0];
    let path = `M ${x(start.second).toFixed(2)} ${y(start.price).toFixed(2)}`;
    for (const point of points.slice(1)) {
      path += ` H ${x(point.second).toFixed(2)} V ${y(point.price).toFixed(2)}`;
    }
    path += ` H ${x(lastTime).toFixed(2)}`;
    fragment.append(shape("path", {d: path, fill: "none", stroke: warmup ? "#67957f" : "#146657",
      "stroke-width": 2.1, "stroke-linejoin": "round", "stroke-dasharray": warmup ? "3 3" : "none"}));
  }
  trace(preopen, 0, true);
  if (end > 0) {
    if (preopen.length) live.unshift({second: 0, price: preopen[preopen.length - 1].price});
    trace(live, end, false);
  }
  fragment.append(shape("circle", {cx: x(end), cy: y(quote), r: 3, fill: "#146657"}));
  const graph = $("ticketGraph");
  graph.replaceChildren(fragment);
  graph.setAttribute("aria-label", `UP ticket buy quote. Currently ${pts(quote)} points, range ${pts(Math.min(...prices))} to ${pts(Math.max(...prices))}.`);
  label("tapeQuote", pts(quote));
  label("tapeStart", first < 0 ? "Dashed · simulated pre-open" : timer(first));
  label("tapeEnd", s.phase === "lobby" ? "Opening bell" : timer(end) + " elapsed");
}
function roomCount(s) {
  const students = num.format(s.players) + (s.players === 1 ? " student team" : " student teams");
  return s.npcCount ? students + " · " + s.npcCount + " simulated traders" : students;
}
const quantityControl = $("quantity");
const ticketLabel = (quantity) => quantity === 1 ? "ticket" : "tickets";
function selectedQuantity() {
  return Number(quantityControl?.value || 1);
}
function orderQuote(side, quantity) {
  const key = action + (side === "up" ? "Up" : "Down");
  // A host tab opened before quantity selection shipped still provides single-ticket quotes.
  return state.quoteTotals?.[key]?.[quantity - 1] ?? state.quotes[key];
}
function executionLimit(quote, quantity) {
  if (!state.npcCount) return quote;
  const allowance = quantity * quoteAllowance;
  return action === "buy"
    ? Math.min(state.me?.cash ?? 100, quantity * 10, Math.floor((quote + allowance) * 100) / 100)
    : Math.max(0, Math.ceil((quote - allowance) * 100) / 100);
}
function setOrders() {
  if (!state) return;
  const s = state;
  ["buy", "sell"].forEach((a) => $(a).setAttribute("aria-pressed", a === action));
  if (quantityControl) {
    if (!s.quoteTotals) quantityControl.value = "1";
    quantityControl.disabled = busy || !s.quoteTotals;
  }
  const quantity = selectedQuantity();
  const verb = action === "buy" ? "Buy" : "Sell";
  for (const side of ["up", "down"]) {
    const quote = orderQuote(side, quantity);
    const limit = executionLimit(quote, quantity);
    const limitText = (action === "buy" ? "Max " : "Min ") + pts(limit) + " pts total";
    label(side + "Order", verb + " " + quantity + " · " + (s.npcCount ? "≈" : "") + pts(quote) + " pts");
    label(side + "Limit", s.npcCount && (action !== "buy" || !s.me || s.me.cash >= quote) ? limitText : "");
    $(side + "Order").setAttribute("aria-label",
      `${verb} ${quantity} ${side.toUpperCase()} ${ticketLabel(quantity)} for ${pts(quote)} points total` +
      (s.npcCount ? ". " + limitText : ""));
    if ($(side + "Unit")) label(side + "Unit", "1 ticket · " + pts(orderQuote(side, 1)) + " pts");
    label(side + "Held", (s.me?.[side] ?? 0) + " held");
    $(side + "Order").disabled =
      busy ||
      s.phase !== "trading" ||
      !s.me ||
      (action === "buy" ? quote > s.me.cash : s.me[side] < quantity);
  }
}
function paint(s) {
  const old = state;
  state = s;
  const net = ["network", "discussion"].includes(s.phase),
    done = Boolean(s.reveal),
    inGame = s.phase === "trading";
  if (old && old.roundId !== s.roundId) {
    action = "buy";
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
        : "It’s a volatile week in mid-May 2021. Trade four hours of Bitcoin history in five minutes using classroom points.",
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
  label("price", net ? num.format(s.network.blocks.length) + " blocks" : usd.format(s.lastPrice));
  document.querySelector(".smalltitle").textContent = net
    ? "Bitcoin / Network activity"
    : "Historical Bitcoin / US Dollar";
  const diff = s.lastPrice - s.startPrice;
  label(
    "priceDelta",
    net
      ? num.format(s.network.txCount) + " transactions included"
      : s.phase === "lobby"
        ? "Opening price"
        : (diff < 0 ? "−" : "+") + usd.format(Math.abs(diff)) + " from the open",
  );
  label("clockTitle", net ? "Network replay" : "Market clock");
  label(
    "clock",
    net ? timer(Math.ceil(s.network.duration - s.network.elapsed)) : timer(s.remaining),
  );
  $("graph").setAttribute(
    "aria-label",
    net
      ? "Recorded blocks and transactions during the network replay"
      : "Bitcoin price during the historical replay",
  );
  label("axisMiddle", net ? "Bar height = transaction count" : "Historical time elapsed");
  label("openLabel", net ? "0 hours" : "Opening bell");
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
  show("portfolio", !!s.me);
  label("seat", s.me ? s.me.name : done ? "Spectator" : "");
  show("positionReturn", Boolean(s.me) && inGame);
  if (s.me) {
    label("wallet", pts(done ? s.me.points : s.me.cash) + " pts");
    show("tradePanel", !done);
    document.querySelector(".balance span").textContent = done
      ? "Settled balance"
      : "Available balance";
    if (inGame) {
      const gain = s.me.points - 100;
      label("gain", (gain < 0 ? "−" : "+") + pts(Math.abs(gain)) + " pts");
      $("gain").classList.toggle("loss", gain < 0);
    }
  }
  label("ticketHeading", done ? "Your result" : "Your position");
  label(
    "orderNote",
    !s.quoteTotals
      ? "This room supports one ticket per order. Ask the host to refresh for larger orders."
      : s.phase === "lobby"
        ? "Orders open when the host starts the clock."
        : s.npcCount
          ? "Quotes move as orders arrive. Each ticket can fill up to 0.15 points above a buy quote or below a sell quote."
          : "All teams see the same quotes. Buying or selling tickets moves the price.",
  );
  setOrders();
  show("result", done);
  show("network", net);
  show("discussion", s.phase === "discussion");
  if (done) {
    $("priceSource").href = s.reveal.source;
    label("winner", s.reveal.winner.toUpperCase() + " pays 10 points");
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
    label("score", s.me ? pts(s.me.points) : "—");
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
    b.textContent = pts(r.points) + " pts";
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
        ? (body.action === "buy" ? "Bought" : "Sold") +
            ` ${body.quantity} ${body.side.toUpperCase()} ${ticketLabel(body.quantity)} for ${pts(Math.abs(updated.me.cash - previousCash))} pts total.`
        : "",
    );
  } catch (e) {
    if (path === "trade") {
      // Refresh the quote and wallet after a rejection. Never resubmit an order.
      try { await call("state"); } catch { /* Keep the original order error visible. */ }
    }
    const message = e.message.startsWith("Another team traded")
      ? "The price moved outside your order limit. Check the new quote and try again."
      : e.message;
    label("notice", message);
    label("status", message);
    show("status", true);
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
  setTimeout(refresh, state?.phase === "trading" && state.npcCount ? 600 : 1000);
}
$("joinForm").onsubmit = (e) => {
  e.preventDefault();
  submit("join", { name: $("team").value.trim() });
};
for (const a of ["buy", "sell"])
  $(a).onclick = () => {
    action = a;
    setOrders();
  };
if (quantityControl) quantityControl.onchange = setOrders;
for (const side of ["up", "down"]) {
  $(side + "Order").onclick = () => {
    const quantity = selectedQuantity();
    submit("trade", { side, action, quantity, quoteLimit: executionLimit(orderQuote(side, quantity), quantity) });
  };
}
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
    "Join with a team name to get 100 points. Everyone sees the same four hours of mid-May 2021 Bitcoin prices, replayed in five minutes. A real minute covers 48 historical minutes.",
    "Pick UP if you think Bitcoin will finish above its opening price. Pick DOWN if you expect an equal or lower close. Use Buy or Sell to change your position before time runs out.",
    "One winning ticket pays 10 points. A losing ticket pays zero. Twenty simulated traders react to the Bitcoin prices revealed so far. Their orders and yours move the ticket price in points. The dashed part of the ticket chart shows simulated trading before the opening bell.",
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
  label("priceDelta", "Four historical hours");
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
