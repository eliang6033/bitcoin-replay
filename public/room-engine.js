/* Shared-room authority in the presenter's browser. Only request() results go to peers. */
(() => {
  "use strict";
  const PAYOUT = 10;
  const LIQUIDITY = 18;
  const LEGACY_LIQUIDITY = 40;
  const MAX_ORDER = 10;
  const PERCENTAGES = [10, 25, 50, 100];
  const NETWORK_SECONDS = 60;
  const HISTORICAL_MINUTES = 240;
  const NPC_COUNT = 20;
  const SIDES = ["up", "down"];
  const PREOPEN_TRADES = 12;
  const FEED_LIMIT = 64;

  function error(message, status = 400) {
    throw Object.assign(new Error(message), { status, rejected: true });
  }

  const money = (value) => Math.round(value * 10000) / 10000;
  const utc = (seconds) => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

  class BitcoinReplayRoom {
    constructor(data, { clock = () => Date.now() / 1000, duration = 300, saved, seed } = {}) {
      this.data = data;
      this.clock = clock;
      this.duration = duration;
      this.seed = seed;
      this.prices = data.prices
        .map(({ time, price }) => ({
          minute: (time - data.start) / 60,
          price,
        }))
        .sort((a, b) => a.minute - b.minute);
      if (
        data.end - data.start !== HISTORICAL_MINUTES * 60 ||
        this.prices.length !== HISTORICAL_MINUTES + 1 ||
        this.prices.some((p, i) => p.minute !== i || !Number.isFinite(p.price) || p.price <= 0)
      ) {
        throw new Error("Expected a four-hour minute-by-minute BTC price series.");
      }
      this.blocks = data.blocks
        .filter((b) => b.time >= data.start && b.time < data.end)
        .map((b) => ({
          height: b.height,
          minute: (b.time - data.start) / 60,
          transactions: b.tx_count,
          id: b.id,
        }))
        .sort((a, b) => a.minute - b.minute);
      this.txCount = this.blocks.reduce((total, b) => total + b.transactions, 0);
      if (saved?.version === 1 && saved.windowStart === data.start) {
        this.phase = saved.phase;
        this.started = saved.started;
        this.networkStarted = saved.networkStarted;
        this.roundId = saved.roundId;
        this.units = { ...saved.units };
        this.players = new Map(saved.players.map(([key, player]) => [key, { ...player }]));
        this.executed = new Map(saved.executed);
        this.revision = saved.revision || 0;
        this.tradeLog = saved.tradeLog || (saved.tradeFeed || []).filter(f => f.actor === "team").map(f => [
          saved.players.find(([, p]) => p.name === f.name)?.[0], { ...f, legacy: true },
        ]);
        this.auditComplete = saved.auditComplete ?? false;
        this.tradeFeed = (saved.tradeFeed || []).slice(-FEED_LIMIT);
        if (saved.market) {
          this.market = {
            ...saved.market,
            liquidity: saved.market.liquidity ?? LEGACY_LIQUIDITY,
            traders: saved.market.traders.map(p => ({ ...p })),
            history: saved.market.history.map(p => ({ ...p })),
          };
        } else {
          // A market already played on the old site keeps its original book.
          this.initMarket(this.phase === "lobby");
        }
      } else {
        this.reset();
      }
    }

    save() {
      return {
        version: 1,
        windowStart: this.data.start,
        phase: this.phase,
        started: this.started,
        networkStarted: this.networkStarted,
        roundId: this.roundId,
        units: { ...this.units },
        players: Array.from(this.players, ([key, player]) => [key, { ...player }]),
        executed: Array.from(this.executed),
        revision: this.revision,
        tradeLog: this.tradeLog.slice(),
        auditComplete: this.auditComplete,
        tradeFeed: this.tradeFeed.slice(),
        market: {
          ...this.market,
          traders: this.market.traders.map(p => ({ ...p })),
          history: this.market.history.slice(),
        },
      };
    }

    reset() {
      this.phase = "lobby";
      this.started = null;
      this.networkStarted = null;
      this.roundId = globalThis.crypto.randomUUID();
      this.units = { up: 0, down: 0 };
      this.players = new Map();
      this.executed = new Map();
      this.revision = 0;
      this.tradeLog = [];
      this.auditComplete = true;
      this.tradeFeed = [];
      this.initMarket(true);
    }

    initMarket(enabled) {
      this.market = {
        liquidity: enabled ? LIQUIDITY : LEGACY_LIQUIDITY,
        randomState: this.seed ?? Number.parseInt(this.roundId.replace(/-/g, "").slice(0, 8), 16),
        nextMs: 1100, lastMinute: 0, burstUntilMs: 0, trades: 0,
        sentiment: 0,
        traders: [], history: [],
      };
      if (!enabled) {
        this.recordTicket(this.elapsed(this.clock()));
        return;
      }
      this.market.traders = Array.from({ length: NPC_COUNT }, (_, i) => ({
        name: "NPC " + String(i + 1).padStart(2, "0"), cash: 100, up: 0, down: 0,
      }));
      // Simulated opening orders use only the opening book. A balanced set
      // gives every class the same starting quote while the path can vary.
      const sides = Array.from({ length: PREOPEN_TRADES }, (_, i) => SIDES[i % 2]);
      for (let i = sides.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [sides[i], sides[j]] = [sides[j], sides[i]];
      }
      this.recordTicket(-PREOPEN_TRADES);
      sides.forEach((side, i) => {
        this.fill(this.market.traders[i], side, 1, this.quote(side, 1));
        this.recordTicket(i + 1 - PREOPEN_TRADES);
      });
    }

    random() {
      const m = this.market;
      m.randomState = (Math.imul(m.randomState, 1664525) + 1013904223) >>> 0;
      return m.randomState / 4294967296;
    }

    elapsed(now) {
      return this.started === null ? 0 : Math.min(this.duration, Math.max(0, now - this.started));
    }

    recordTicket(elapsed) {
      const history = this.market.history;
      const last = history[history.length - 1];
      const second = Math.max(last?.second ?? -Infinity, Math.floor(elapsed * 4) / 4);
      const point = { second, price: money(this.quote("up", 1)), downPrice: money(this.quote("down", 1)) };
      if (last?.second === second) {
        history[history.length - 1] = point;
      } else {
        history.push(point);
      }
    }

    fill(player, side, delta, cost) {
      player.cash = Math.max(0, player.cash - cost);
      player[side] += delta;
      this.units[side] += delta;
    }

    recordTrade(second, actor, name, action, side, quantity, cost) {
      const last = this.tradeFeed[this.tradeFeed.length - 1];
      const id = last ? last.id + 1 : 1;
      if (this.tradeFeed.length === FEED_LIMIT) this.tradeFeed.shift();
      this.tradeFeed.push({
        id, actor, name, action, side, quantity, total: money(Math.abs(cost)),
        second: Math.max(second, last?.second ?? 0),
      });
    }

    npcOrder(minute, second) {
      const traders = this.market.traders;
      const who = Math.floor(this.random() * traders.length);
      const trader = traders[who];
      const current = this.prices[minute].price;
      const sinceOpen = Math.log(current / this.prices[0].price);
      const recent = Math.log(current / this.prices[Math.max(0, minute - 4)].price);
      // NPCs form opinions about the closing outcome using only revealed candles.
      // The same gap from the opening price matters more as time runs out.
      const uncertainty = 0.006 + 0.031 * Math.sqrt(1 - minute / HISTORICAL_MINUTES);
      const momentum = (who % 5 === 0 ? -0.3 : 1.0) * Math.tanh(recent / 0.022);
      // A simulated belief from about 2% to 98%, on the market's log-odds scale.
      const sentiment = this.market.sentiment ?? 0;
      const opinion = (who % 4 === 0 ? -0.55 : 1) * sentiment;
      const target = Math.max(-3.9, Math.min(3.9, sinceOpen / uncertainty + momentum + opinion));
      const gap = target - (this.units.up - this.units.down) / this.market.liquidity;
      const leanUp = 0.5 + 0.46 * Math.tanh(1.5 * gap);
      const side = this.random() < leanUp ? "up" : "down";
      const other = side === "up" ? "down" : "up";
      let fillSide = side;
      let delta = Math.min(MAX_ORDER, 1 + Math.floor(3 * Math.abs(gap)));
      if (trader[other] > 0) {
        // Selling the other outcome moves the odds in the same direction.
        fillSide = other;
        delta = -Math.min(trader[other], delta);
      } else {
        while (delta && this.quote(side, delta) > trader.cash) delta--;
        if (!delta) return false;
      }
      const cost = this.quote(fillSide, delta);
      this.fill(trader, fillSide, delta, cost);
      this.recordTrade(second, "npc", trader.name, delta > 0 ? "buy" : "sell", fillSide, Math.abs(delta), cost);
      return true;
    }

    advanceMarket(elapsed) {
      const m = this.market;
      if (!m.traders.length) return;
      // Each event uses its scheduled time, even after a sleeping host wakes.
      // No order can use the closing candle, which settles the tickets.
      while (m.nextMs <= elapsed * 1000 && m.nextMs < this.duration * 1000) {
        const at = m.nextMs;
        const minute = Math.floor(at * HISTORICAL_MINUTES / (this.duration * 1000));
        for (let i = m.lastMinute + 1; i <= minute; i++) {
          const threshold = i >= HISTORICAL_MINUTES - 15 ? 0.006 : 0.012;
          if (Math.abs(Math.log(this.prices[i].price / this.prices[i - 1].price)) >= threshold) {
            m.burstUntilMs = at + 3500;
          }
        }
        m.lastMinute = minute;
        // Correlated crowd sentiment creates runs and reversals. The schedule
        // and RNG are saved so refreshing cannot change a round's outcome.
        m.sentiment = 0.96 * (m.sentiment ?? 0) + (this.random() - 0.5) * 0.8;
        if (this.npcOrder(minute, at / 1000)) {
          m.trades++;
          this.recordTicket(at / 1000);
        }
        const fast = at < m.burstUntilMs;
        m.nextMs += Math.round(fast ? 170 + 120 * this.random() : 610 + 440 * this.random());
      }
    }

    probability(side) {
      const other = side === "up" ? "down" : "up";
      const difference = (this.units[side] - this.units[other]) / this.market.liquidity;
      return 1 / (1 + Math.exp(-difference));
    }

    quote(side, delta) {
      const depth = this.market.liquidity;
      const other = side === "up" ? "down" : "up";
      const before = this.units[side] - this.units[other], after = before + delta;
      // LMSR cost difference. Splitting off the linear part keeps even a full
      // liquidation finite when almost everyone previously backed one side.
      const premium = n => Math.log1p(Math.exp(-Math.abs(n) / depth));
      return PAYOUT * (Math.max(after, 0) - Math.max(before, 0) + depth * (premium(after) - premium(before)));
    }

    affordable(side, budget) {
      if (budget <= 0) return 0;
      const other = side === "up" ? "down" : "up";
      // After the two outcomes are level, every further purchase costs at
      // least half the payout. This bounds the search even at a tiny quote.
      let high = Math.ceil(Math.max(0, this.units[other] - this.units[side]) + 2 * budget / PAYOUT);
      let low = 0;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (this.quote(side, mid) <= budget + 1e-9) low = mid;
        else high = mid - 1;
      }
      return low;
    }

    sharesForCash(side, budget) {
      if (budget <= 0) return 0;
      const other = side === "up" ? "down" : "up";
      let low = 0;
      let high = Math.max(0, this.units[other] - this.units[side]) + 2 * budget / PAYOUT;
      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        if (this.quote(side, mid) <= budget) low = mid;
        else high = mid;
      }
      return low;
    }

    cashOutValue(player) {
      // One of every matched Higher/Lower pair pays out. Removing pairs
      // leaves the book's odds unchanged, so only unpaired shares move them.
      const paired = Math.min(player.up, player.down);
      const side = player.up > player.down ? "up" : "down";
      return paired * PAYOUT - this.quote(side, -Math.abs(player.up - player.down));
    }

    bulkQuotes(player) {
      const bulk = { cashOut: { quantity: player.up + player.down, total: money(this.cashOutValue(player)) } };
      for (const side of SIDES) {
        const buy = {}, sell = {}, fractions = {};
        for (const percent of PERCENTAGES) {
          const nBuy = this.affordable(side, player.cash * percent / 100);
          const nSell = Math.min(player[side], player[side] ? Math.max(1, Math.floor(player[side] * percent / 100)) : 0);
          buy[percent] = { quantity: nBuy, total: money(this.quote(side, nBuy)) };
          sell[percent] = { quantity: nSell, total: money(Math.abs(this.quote(side, -nSell))) };
          const budget = percent === 100 ? player.cash : player.cash * percent / 100;
          const quantity = percent === 100 ? player[side] : player[side] * percent / 100;
          fractions[percent] = {
            buy: { amount: money(budget), quantity: this.sharesForCash(side, budget) },
            sell: { quantity, total: money(-this.quote(side, -quantity)) },
          };
        }
        const spend = {};
        for (const choice of ["10", "25", "50", "all"]) {
          const budget = choice === "all" ? player.cash : Math.min(Number(choice), player.cash);
          spend[choice] = { amount: money(budget), quantity: this.sharesForCash(side, budget) };
        }
        const half = player[side] / 2;
        bulk[side] = { buy, sell, spend, fractions, exit: {
          half: { quantity: half, total: money(-this.quote(side, -half)) },
          all: { quantity: player[side], total: money(-this.quote(side, -player[side])) },
        } };
      }
      return bulk;
    }

    join(key, name) {
      if (this.players.has(key)) return;
      if (!["lobby", "trading"].includes(this.phase)) error("This round has closed.", 409);
      if (typeof key !== "string" || !key || key.length > 256)
        error("Missing player identity.", 403);
      if (typeof name !== "string") error("Enter your nickname.");
      name = name.trim().replace(/\s+/gu, " ");
      if (!name || [...name].length > 24 || /[\p{C}]/u.test(name)) {
        error("Use a nickname between 1 and 24 characters.");
      }
      for (const player of this.players.values()) {
        if (player.name.toLowerCase() === name.toLowerCase())
          error("That nickname is taken.", 409);
      }
      if (this.players.size >= 300) error("The room is full.", 409);
      this.players.set(key, { name, cash: 100, up: 0, down: 0 });
    }

    trade(key, { side, action, quantity = 1, amount, minQuantity, orderId, quoteLimit }, now) {
      const player = this.players.get(key);
      if (!player) error("Join the room first.", 403);
      const cashOrder = action === "buyCash";
      const signature = [side, action, cashOrder ? amount : quantity];
      let reference;
      if (orderId != null) {
        if (typeof orderId !== "string" || !orderId.length || orderId.length > 64) {
          error("Invalid trade reference.");
        }
        reference = JSON.stringify([key, orderId]);
        const previous = this.executed.get(reference);
        if (previous) {
          if (signature.some((value, i) => value !== previous[i])) {
            error("Trade reference already used for a different order.", 409);
          }
          return this.tradeLog.find(([k, fill]) => k === key && fill.orderId === orderId)?.[1] || null;
        }
      }
      if (this.phase !== "trading") error("Trading is closed.", 409);
      const all = side === "both" && action === "sellAll";
      if (!all && (!SIDES.includes(side) || !["buy", "sell", "buyCash"].includes(action))) {
        error("Choose an outcome and a trade.");
      }
      if (cashOrder) {
        if (!Number.isFinite(amount) || amount <= 0 || amount > player.cash + 0.000051)
          error("Choose an amount within your available cash.");
        amount = Math.min(amount, player.cash);
        quantity = this.sharesForCash(side, amount);
        if (minQuantity != null && (!Number.isFinite(minQuantity) || minQuantity < 0))
          error("Invalid minimum purchase.");
        if (minQuantity != null && quantity < minQuantity)
          error("The price changed. Check the new total and try again.", 409);
      }
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER)
        error("Choose a positive number of shares.");
      if (action === "buy" && !Number.isSafeInteger(quantity)) error("Choose a whole number of shares.");
      if (all && quantity !== player.up + player.down) {
        error("Your holdings changed. Check your balance and try again.", 409);
      }
      const buying = action === "buy" || cashOrder;
      const delta = buying ? quantity : -quantity;
      if (!all && delta < 0 && player[side] < quantity) error("You can only sell shares you own.", 409);
      const cost = cashOrder ? amount : all ? -this.cashOutValue(player) : this.quote(side, delta);
      if (quoteLimit != null) {
        if (!Number.isFinite(quoteLimit) || quoteLimit < 0 || quoteLimit > quantity * PAYOUT)
          error("Invalid total quote.");
        const total = money(Math.abs(cost));
        if (buying ? total > quoteLimit : total < quoteLimit)
          error("The price changed. Check the new total and try again.", 409);
      }
      if (cost > player.cash + 1e-9) error("You need more practice cash for this trade.", 409);
      const cashBefore = player.cash;
      const holdingsBefore = { up: player.up, down: player.down };
      const marketPrice = all ? null : PAYOUT * this.probability(side);
      if (all) {
        for (const outcome of SIDES) {
          this.units[outcome] -= player[outcome];
          player[outcome] = 0;
        }
        player.cash -= cost;
      } else {
        this.fill(player, side, delta, cost);
      }
      const elapsed = this.elapsed(now);
      this.recordTicket(elapsed);
      this.recordTrade(elapsed, "team", player.name, cashOrder ? "buy" : action, side, quantity, cost);
      const receipt = {
        ...this.tradeFeed[this.tradeFeed.length - 1], orderId: orderId || null,
        cashBefore: money(cashBefore), cashAfter: money(player.cash),
        holdingsBefore, holdingsAfter: { up: player.up, down: player.down },
        marketPrice: marketPrice === null ? null : money(marketPrice),
        averagePrice: money(Math.abs(cost) / quantity),
        bitcoinPrice: this.prices[Math.floor(elapsed * HISTORICAL_MINUTES / this.duration)].price,
      };
      this.tradeLog.push([key, receipt]);
      if (reference) this.executed.set(reference, signature);
      return receipt;
    }

    auditReport(now) {
      const revealed = ["settled", "network", "discussion"].includes(this.phase);
      const winner = revealed ? (this.prices[HISTORICAL_MINUTES].price > this.prices[0].price ? "up" : "down") : null;
      return {
        format: "Bitcoin Replay round log v1", roundId: this.roundId,
        phase: this.phase, elapsed: this.elapsed(now), duration: this.duration,
        completeHumanHistory: this.auditComplete,
        note: this.auditComplete ? "All confirmed human trades in this round." : "This round began on an older version. Earlier human fills may be missing; order inputs do not include execution times or prices.",
        units: { ...this.units }, liquidity: this.market.liquidity,
        winner, startPrice: this.prices[0].price,
        lastPrice: this.prices[Math.floor(this.elapsed(now) * HISTORICAL_MINUTES / this.duration)].price,
        players: Array.from(this.players.values(), p => ({ ...p,
          total: money(p.cash + (revealed ? p[winner] * PAYOUT : this.cashOutValue(p))),
        })),
        trades: this.tradeLog.map(([, fill]) => ({ ...fill })),
        recentTrades: this.tradeFeed.slice(),
        orderInputs: Array.from(this.executed, ([reference, order]) => ({
          name: this.players.get(JSON.parse(reference)[0])?.name, side: order[0], action: order[1], amountOrQuantity: order[2],
        })),
        ticketHistory: this.market.history.slice(),
        moneyUnit: "Multiply stored money values by 1000 for displayed practice USD.",
      };
    }

    hostAction(action, now) {
      if (action === "reset") {
        this.reset();
      } else if (action === "start" && this.phase === "lobby") {
        this.phase = "trading";
        this.started = now;
      } else if (
        ["settled", "network", "discussion"].includes(this.phase) &&
        action === "network"
      ) {
        this.phase = "network";
        this.networkStarted = now;
      } else if (
        ["settled", "network", "discussion"].includes(this.phase) &&
        action === "discussion"
      ) {
        this.phase = "discussion";
      } else {
        error("That control is unavailable at this stage.", 409);
      }
    }

    request(path, body, playerKey, isHost, joinUrl) {
      const now = this.clock();
      if (this.phase === "trading") {
        const elapsed = this.elapsed(now);
        this.advanceMarket(elapsed);
        if (elapsed >= this.duration) this.phase = "settled";
      }
      let tradeReceipt;
      switch (path.replace(/^\/api\//, "")) {
        case "state":
          break;
        case "join":
          this.join(playerKey, body?.name);
          break;
        case "trade":
          tradeReceipt = this.trade(playerKey, body || {}, now);
          break;
        case "audit":
          if (isHost !== true) error("Only the host can download the round log.", 403);
          return this.auditReport(now);
        case "host":
          if (isHost !== true) error("Only the host can use this control.", 403);
          this.hostAction(body?.action, now);
          break;
        default:
          error("Unknown endpoint.", 404);
      }
      const result = this.state(now, playerKey, isHost === true, joinUrl);
      if (tradeReceipt) result.tradeReceipt = { ...tradeReceipt };
      return result;
    }

    state(now, key, host, joinUrl) {
      const elapsed = this.elapsed(now);
      const lastMinute = Math.floor((elapsed * HISTORICAL_MINUTES) / this.duration);
      const prices = this.prices.slice(0, lastMinute + 1);
      const revealed = ["settled", "network", "discussion"].includes(this.phase);
      const winner = this.prices[HISTORICAL_MINUTES].price > this.prices[0].price ? "up" : "down";
      const upPrice = PAYOUT * this.probability("up");
      const points = (p) =>
        money(
          p.cash + (revealed ? p[winner] * PAYOUT : this.cashOutValue(p)),
        );
      const player = this.players.get(key);
      let networkElapsed =
        this.networkStarted === null
          ? 0
          : Math.min(NETWORK_SECONDS, Math.max(0, now - this.networkStarted));
      if (this.phase === "discussion") networkElapsed = NETWORK_SECONDS;
      const blocks = ["network", "discussion"].includes(this.phase)
        ? this.blocks.filter(
            (b) => b.minute <= (networkElapsed * HISTORICAL_MINUTES) / NETWORK_SECONDS,
          )
        : [];
      const quoteTotals = {};
      const support = { up: 0, down: 0 };
      for (const player of this.players.values()) {
        if (player.up > 0) support.up++;
        if (player.down > 0) support.down++;
      }
      for (const side of ["up", "down"]) {
        const suffix = side === "up" ? "Up" : "Down";
        for (const [action, sign] of [["buy", 1], ["sell", -1]]) {
          quoteTotals[action + suffix] = Array.from({ length: MAX_ORDER }, (_, i) =>
            money(Math.abs(this.quote(side, sign * (i + 1)))),
          );
        }
      }
      return {
        phase: this.phase,
        roundId: this.roundId,
        revision: ++this.revision,
        host,
        joinUrl,
        remaining: Math.ceil(this.duration - elapsed),
        elapsed,
        duration: this.duration,
        prices,
        startPrice: this.prices[0].price,
        lastPrice: prices[prices.length - 1].price,
        upPrice: money(upPrice),
        downPrice: money(PAYOUT - upPrice),
        quotes: Object.fromEntries(Object.entries(quoteTotals).map(([key, totals]) => [key, totals[0]])),
        quoteTotals,
        bulk: player && !revealed ? this.bulkQuotes(player) : null,
        players: this.players.size,
        support,
        npcCount: this.market.traders.length,
        npcTrades: this.market.trades,
        ticketHistory: this.market.history.slice(),
        tradeFeed: this.tradeFeed.slice(),
        myTrades: this.tradeLog.filter(([owner]) => owner === key).map(([, fill]) => ({ ...fill })),
        auditComplete: this.auditComplete,
        me: player ? { ...player, cash: money(player.cash), points: points(player) } : null,
        rankings: Array.from(this.players.values(), (p) => ({
          name: p.name,
          points: points(p),
        })).sort((a, b) => b.points - a.points),
        reveal: revealed
          ? {
              startUtc: utc(this.data.start),
              endUtc: utc(this.data.end),
              winner,
              blockCount: this.blocks.length,
              txCount: this.txCount,
              source: this.data.priceSource,
              blockSource: this.data.blockSource,
            }
          : null,
        network: {
          elapsed: networkElapsed,
          duration: NETWORK_SECONDS,
          blocks,
          txCount: blocks.reduce((sum, b) => sum + b.transactions, 0),
        },
      };
    }
  }
  globalThis.BitcoinReplayRoom = BitcoinReplayRoom;
})();
