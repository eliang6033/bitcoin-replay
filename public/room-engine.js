/* Shared-room authority in the presenter's browser. Only request() results go to peers. */
(() => {
  "use strict";
  const PAYOUT = 10;
  const LIQUIDITY = 40;
  const NETWORK_SECONDS = 60;
  const HISTORICAL_MINUTES = 240;

  function error(message, status = 400) {
    throw Object.assign(new Error(message), { status });
  }

  const money = (value) => Math.round(value * 10000) / 10000;
  const utc = (seconds) => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

  class BitcoinReplayRoom {
    constructor(data, { clock = () => Date.now() / 1000, duration = 300, saved } = {}) {
      this.data = data;
      this.clock = clock;
      this.duration = duration;
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
    }

    probability(side) {
      const other = side === "up" ? "down" : "up";
      const difference = (this.units[side] - this.units[other]) / LIQUIDITY;
      return 1 / (1 + Math.exp(-difference));
    }

    quote(side, delta) {
      return (
        PAYOUT * LIQUIDITY * Math.log1p(this.probability(side) * Math.expm1(delta / LIQUIDITY))
      );
    }

    join(key, name) {
      if (this.players.has(key)) return;
      if (!["lobby", "trading"].includes(this.phase)) error("This round has closed.", 409);
      if (typeof key !== "string" || !key || key.length > 256)
        error("Missing player identity.", 403);
      if (typeof name !== "string") error("Enter a team name.");
      name = name.trim().replace(/\s+/gu, " ");
      if (!name || [...name].length > 24 || /[\p{C}]/u.test(name)) {
        error("Use a team name between 1 and 24 characters.");
      }
      for (const player of this.players.values()) {
        if (player.name.toLowerCase() === name.toLowerCase())
          error("That team name is taken.", 409);
      }
      if (this.players.size >= 300) error("The room is full.", 409);
      this.players.set(key, { name, cash: 100, up: 0, down: 0 });
    }

    trade(key, { side, action, quantity = 1, orderId }) {
      const player = this.players.get(key);
      if (!player) error("Join the room first.", 403);
      let reference;
      if (orderId != null) {
        if (typeof orderId !== "string" || !orderId.length || orderId.length > 64) {
          error("Invalid trade reference.");
        }
        reference = JSON.stringify([key, orderId]);
        const previous = this.executed.get(reference);
        if (previous) {
          if (side !== previous[0] || action !== previous[1] || quantity !== previous[2]) {
            error("Trade reference already used for a different order.", 409);
          }
          return;
        }
      }
      if (this.phase !== "trading") error("Trading is closed.", 409);
      if (!["up", "down"].includes(side) || !["buy", "sell"].includes(action)) {
        error("Choose Buy or Sell and a side.");
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        error("Choose 1 to 10 tickets per order.");
      }
      const delta = action === "buy" ? quantity : -quantity;
      const cost = this.quote(side, delta);
      if (delta < 0 && player[side] < quantity) error("You can only sell tickets you own.", 409);
      if (delta > 0 && cost > player.cash + 1e-9)
        error("You need more points for this trade.", 409);
      player.cash = Math.max(0, player.cash - cost);
      player[side] += delta;
      this.units[side] += delta;
      if (reference) this.executed.set(reference, [side, action, quantity]);
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
      if (this.phase === "trading" && now - this.started >= this.duration) this.phase = "settled";
      switch (path.replace(/^\/api\//, "")) {
        case "state":
          break;
        case "join":
          this.join(playerKey, body?.name);
          break;
        case "trade":
          this.trade(playerKey, body || {});
          break;
        case "host":
          if (isHost !== true) error("Only the host can use this control.", 403);
          this.hostAction(body?.action, now);
          break;
        default:
          error("Unknown endpoint.", 404);
      }
      return this.state(now, playerKey, isHost === true, joinUrl);
    }

    state(now, key, host, joinUrl) {
      const elapsed =
        this.started === null ? 0 : Math.min(this.duration, Math.max(0, now - this.started));
      const lastMinute = Math.floor((elapsed * HISTORICAL_MINUTES) / this.duration);
      const prices = this.prices.slice(0, lastMinute + 1);
      const revealed = ["settled", "network", "discussion"].includes(this.phase);
      const winner = this.prices[HISTORICAL_MINUTES].price > this.prices[0].price ? "up" : "down";
      const upPrice = PAYOUT * this.probability("up");
      const points = (p) =>
        money(
          p.cash + (revealed ? p[winner] * PAYOUT : p.up * upPrice + p.down * (PAYOUT - upPrice)),
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
      return {
        phase: this.phase,
        roundId: this.roundId,
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
        quotes: {
          buyUp: money(this.quote("up", 1)),
          buyDown: money(this.quote("down", 1)),
          sellUp: money(-this.quote("up", -1)),
          sellDown: money(-this.quote("down", -1)),
        },
        players: this.players.size,
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
