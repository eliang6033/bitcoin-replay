"""Single-room Bitcoin Replay for a trusted classroom LAN. Python 3.9+."""
import argparse
import ipaddress
import json
import math
import mimetypes
import secrets
import socket
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent / "public"
ASSETS = {"index.html", "app.js", "style.css", "market.css", "room-qr.js", "vendor/qrcode.js"}
PAYOUT = 10
STARTING_CASH = 100
LIQUIDITY = 18
MAX_ORDER = 10
PERCENTAGES = (10, 25, 50, 100)
NETWORK_DURATION = 60
NPC_COUNT = 20
PREOPEN_TRADES = 12
FEED_LIMIT = 64


class GameError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def money(value):
    return round(value, 4)


class Room:
    def __init__(self, data, duration=300, clock=time.monotonic, seed=None):
        self.data = data
        self.duration = duration
        self.clock = clock
        self.seed = seed
        self.lock = threading.RLock()
        self.start = data["start"]
        self.end = data["end"]
        self.prices = [{"minute": (p["time"] - self.start) / 60, "price": p["price"]}
                       for p in sorted(data["prices"], key=lambda p: p["time"])]
        self.blocks = sorted([{"height": b["height"], "minute": (b["time"] - self.start) / 60,
                               "transactions": b["tx_count"], "id": b["id"]}
                              for b in data["blocks"] if self.start <= b["time"] < self.end],
                             key=lambda b: b["minute"])
        if (self.end - self.start != 14400 or len(self.prices) != 241 or
            any(p["minute"] != i or not math.isfinite(p["price"]) or p["price"] <= 0
                for i, p in enumerate(self.prices))):
            raise ValueError("Expected a four-hour minute-by-minute BTC price series.")
        self.reset()

    def reset(self):
        self.players = {}
        self.units = {"up": 0, "down": 0}
        self.phase = "lobby"
        self.started = self.network_started = None
        self.winner = None
        self.executed = {}
        self.trade_feed = deque(maxlen=FEED_LIMIT)
        self.round_id = secrets.token_hex(5)
        self.rng = (int(self.round_id[:8], 16) if self.seed is None else self.seed) & 0xffffffff
        self.npcs = [{"name": f"NPC {i + 1:02}", "cash": STARTING_CASH, "up": 0, "down": 0}
                     for i in range(NPC_COUNT)]
        self.npc_trades = 0
        self.next_npc_ms = 1100
        self.burst_until_ms = 0
        self.last_npc_minute = 0
        self.sentiment = 0
        self.ticket_history = []
        self.warm_market()

    def random(self):
        # Fixed 32-bit LCG matches the browser engine and is independent of polling.
        self.rng = (1664525 * self.rng + 1013904223) & 0xffffffff
        return self.rng / 4294967296

    def record_ticket(self, seconds):
        point = {"second": math.floor(seconds * 4) / 4,
                 "price": money(self.quote("up", 1)), "downPrice": money(self.quote("down", 1))}
        if self.ticket_history and self.ticket_history[-1]["second"] == point["second"]:
            self.ticket_history[-1] = point
        else:
            self.ticket_history.append(point)

    def fill(self, player, side, delta, cost):
        player["cash"] = max(0, player["cash"] - cost)
        player[side] += delta
        self.units[side] += delta

    def record_trade(self, second, actor, name, action, side, quantity, cost):
        last = self.trade_feed[-1] if self.trade_feed else None
        self.trade_feed.append({
            "id": last["id"] + 1 if last else 1,
            "actor": actor, "name": name, "action": action, "side": side,
            "quantity": quantity, "total": money(abs(cost)),
            "second": max(second, last["second"] if last else 0),
        })

    def warm_market(self):
        self.record_ticket(-PREOPEN_TRADES)
        sides = ["up", "down"] * (PREOPEN_TRADES // 2)
        for i in range(len(sides) - 1, 0, -1):
            j = int(self.random() * (i + 1))
            sides[i], sides[j] = sides[j], sides[i]
        for i, side in enumerate(sides):
            self.fill(self.npcs[i], side, 1, self.quote(side, 1))
            self.record_ticket(i + 1 - PREOPEN_TRADES)

    def npc_order(self, minute, second):
        seat = int(self.random() * NPC_COUNT)
        trader = self.npcs[seat]
        price = self.prices[minute]["price"]
        since_open = math.log(price / self.prices[0]["price"])
        recent = math.log(price / self.prices[max(0, minute - 4)]["price"])
        # These are classroom opinions, built only from already-revealed candles.
        # With less time to recover, the same gap from the opening price matters more.
        uncertainty = 0.006 + 0.031 * math.sqrt(1 - minute / 240)
        momentum = (-0.3 if seat % 5 == 0 else 1.0) * math.tanh(recent / 0.022)
        # The NPC belief spans about 2% to 98% on the market's log-odds scale.
        opinion = (-0.55 if seat % 4 == 0 else 1) * self.sentiment
        target = max(-3.9, min(3.9, since_open / uncertainty + momentum + opinion))
        gap = target - (self.units["up"] - self.units["down"]) / LIQUIDITY
        lean_up = 0.5 + 0.46 * math.tanh(1.5 * gap)
        side = "up" if self.random() < lean_up else "down"
        other = "down" if side == "up" else "up"
        fill_side = side
        delta = min(MAX_ORDER, 1 + math.floor(3.0 * abs(gap)))
        if trader[other]:
            # Selling the other outcome moves the odds in the same direction.
            fill_side = other
            delta = -min(trader[other], delta)
        else:
            while delta and self.quote(side, delta) > trader["cash"]:
                delta -= 1
            if not delta:
                return False
        cost = self.quote(fill_side, delta)
        self.fill(trader, fill_side, delta, cost)
        self.record_trade(second, "npc", trader["name"], "buy" if delta > 0 else "sell", fill_side, abs(delta), cost)
        return True

    def advance_market(self, elapsed):
        # The host clock sets order times. Polling more often cannot generate extra fills.
        while self.next_npc_ms <= elapsed * 1000 and self.next_npc_ms < self.duration * 1000:
            at = self.next_npc_ms
            minute = math.floor(at * 240 / (self.duration * 1000))
            for i in range(self.last_npc_minute + 1, minute + 1):
                threshold = 0.006 if i >= 225 else 0.012
                if abs(math.log(self.prices[i]["price"] / self.prices[i - 1]["price"])) >= threshold:
                    self.burst_until_ms = at + 3500
            self.last_npc_minute = minute
            self.sentiment = 0.96 * self.sentiment + (self.random() - 0.5) * 0.8
            if self.npc_order(minute, at / 1000):
                self.npc_trades += 1
                self.record_ticket(at / 1000)
            interval = 170 + 120 * self.random() if at < self.burst_until_ms else 610 + 440 * self.random()
            self.next_npc_ms += math.floor(interval + 0.5)

    def update(self):
        if self.phase != "trading":
            return 0
        elapsed = max(0, min(self.duration, self.clock() - self.started))
        self.advance_market(elapsed)
        if elapsed >= self.duration:
            self.phase = "settled"
            self.winner = "up" if self.prices[-1]["price"] > self.prices[0]["price"] else "down"
        return elapsed

    def join(self, name, existing):
        self.update()
        if existing in self.players:
            return existing
        if self.phase not in ("lobby", "trading"):
            raise GameError("This round has closed.", 409)
        if not isinstance(name, str):
            raise GameError("Enter your nickname.")
        name = " ".join(name.split())
        if not 1 <= len(name) <= 24 or not name.isprintable():
            raise GameError("Use a nickname between 1 and 24 characters.")
        if any(p["name"].casefold() == name.casefold() for p in self.players.values()):
            raise GameError("That nickname is taken.", 409)
        if len(self.players) >= 300:
            raise GameError("The room is full.", 409)
        key = secrets.token_urlsafe(20)
        self.players[key] = {"name": name, "cash": STARTING_CASH, "up": 0, "down": 0}
        return key

    def probability(self, side):
        diff = self.units[side] - self.units["down" if side == "up" else "up"]
        if diff >= 0:
            return 1 / (1 + math.exp(-diff / LIQUIDITY))
        exponent = math.exp(diff / LIQUIDITY)
        return exponent / (1 + exponent)

    def quote(self, side, delta):
        # Split off the linear part of the LMSR cost. This stays finite even
        # when a large sell order spans two very different market prices.
        other = "down" if side == "up" else "up"
        before = self.units[side] - self.units[other]
        after = before + delta
        premium_before = math.log1p(math.exp(-abs(before) / LIQUIDITY))
        premium_after = math.log1p(math.exp(-abs(after) / LIQUIDITY))
        return PAYOUT * (max(after, 0) - max(before, 0) + LIQUIDITY * (premium_after - premium_before))

    def affordable(self, side, budget):
        if budget <= 0:
            return 0
        other = "down" if side == "up" else "up"
        # Once both outcomes are level, each extra share costs at least half
        # of the payout, giving a finite upper bound even at a tiny price.
        high = math.ceil(max(0, self.units[other] - self.units[side]) + 2 * budget / PAYOUT)
        low = 0
        while low < high:
            mid = (low + high + 1) // 2
            if self.quote(side, mid) <= budget + 1e-9:
                low = mid
            else:
                high = mid - 1
        return low

    def shares_for_cash(self, side, budget):
        if budget <= 0:
            return 0
        other = "down" if side == "up" else "up"
        low = 0
        high = max(0, self.units[other] - self.units[side]) + 2 * budget / PAYOUT
        for _ in range(60):
            mid = (low + high) / 2
            if self.quote(side, mid) <= budget:
                low = mid
            else:
                high = mid
        return low

    def cash_out_value(self, player):
        # Each pair guarantees one payout and its removal leaves the odds
        # unchanged. Apply the normal sale price to the remaining shares.
        paired = min(player["up"], player["down"])
        side = "up" if player["up"] > player["down"] else "down"
        return paired * PAYOUT - self.quote(side, -abs(player["up"] - player["down"]))

    def bulk_quotes(self, player):
        result = {"cashOut": {"quantity": player["up"] + player["down"], "total": money(self.cash_out_value(player))}}
        for side in ("up", "down"):
            buy, sell, fractions = {}, {}, {}
            for percent in PERCENTAGES:
                n_buy = self.affordable(side, player["cash"] * percent / 100)
                n_sell = min(player[side], max(1, player[side] * percent // 100)) if player[side] else 0
                buy[percent] = {"quantity": n_buy, "total": money(self.quote(side, n_buy))}
                sell[percent] = {"quantity": n_sell, "total": money(abs(self.quote(side, -n_sell)))}
                budget = player["cash"] if percent == 100 else player["cash"] * percent / 100
                quantity = player[side] if percent == 100 else player[side] * percent / 100
                fractions[percent] = {
                    "buy": {"amount": money(budget), "quantity": self.shares_for_cash(side, budget)},
                    "sell": {"quantity": quantity, "total": money(-self.quote(side, -quantity))},
                }
            spend = {}
            for choice in ("10", "25", "50", "all"):
                budget = player["cash"] if choice == "all" else min(float(choice), player["cash"])
                spend[choice] = {"amount": money(budget), "quantity": self.shares_for_cash(side, budget)}
            half = player[side] / 2
            result[side] = {"buy": buy, "sell": sell, "spend": spend, "fractions": fractions, "exit": {
                "half": {"quantity": half, "total": money(-self.quote(side, -half))},
                "all": {"quantity": player[side], "total": money(-self.quote(side, -player[side]))},
            }}
        return result

    def trade(self, key, side, action, quantity=1, order_id=None, quote_limit=None, amount=None, min_quantity=None):
        elapsed = self.update()
        cash_order = action == "buyCash"
        signature = (side, action, amount if cash_order else quantity)
        if order_id is not None:
            if not isinstance(order_id, str) or not 1 <= len(order_id) <= 64:
                raise GameError("Invalid trade reference.")
            previous = self.executed.get((key, order_id))
            if previous is not None:
                if previous != signature:
                    raise GameError("Trade reference already used for a different order.", 409)
                return
        if self.phase != "trading":
            raise GameError("Trading is closed.", 409)
        if key not in self.players:
            raise GameError("Join the room first.", 403)
        all_positions = side == "both" and action == "sellAll"
        if not all_positions and (side not in ("up", "down") or action not in ("buy", "sell", "buyCash")):
            raise GameError("Choose an outcome and a trade.")
        player = self.players[key]
        if cash_order:
            if type(amount) not in (int, float) or not math.isfinite(amount) or not 0 < amount <= player["cash"] + 0.000051:
                raise GameError("Choose an amount within your available cash.")
            amount = min(amount, player["cash"])
            quantity = self.shares_for_cash(side, amount)
            if min_quantity is not None and (type(min_quantity) not in (int, float) or not math.isfinite(min_quantity) or min_quantity < 0):
                raise GameError("Invalid minimum purchase.")
            if min_quantity is not None and quantity < min_quantity:
                raise GameError("The price changed. Check the new total and try again.", 409)
        if type(quantity) not in (int, float) or not math.isfinite(quantity) or not 0 < quantity <= 2**53 - 1:
            raise GameError("Choose a positive number of shares.")
        if action == "buy" and type(quantity) is not int:
            raise GameError("Choose a whole number of shares.")
        if all_positions and quantity != player["up"] + player["down"]:
            raise GameError("Your holdings changed. Check your balance and try again.", 409)
        buying = action == "buy" or cash_order
        delta = quantity if buying else -quantity
        if not all_positions and delta < 0 and player[side] < quantity:
            raise GameError("You can only sell shares you own.", 409)
        cost = amount if cash_order else -self.cash_out_value(player) if all_positions else self.quote(side, delta)
        if quote_limit is not None:
            if type(quote_limit) not in (int, float) or not 0 <= quote_limit <= quantity * PAYOUT:
                raise GameError("Invalid total quote.")
            total = money(abs(cost))
            if (buying and total > quote_limit) or (not buying and total < quote_limit):
                raise GameError("The price changed. Check the new total and try again.", 409)
        if cost > player["cash"] + 1e-9:
            raise GameError("You need more practice cash for this trade.", 409)
        if all_positions:
            for outcome in ("up", "down"):
                self.units[outcome] -= player[outcome]
                player[outcome] = 0
            player["cash"] -= cost
        else:
            self.fill(player, side, delta, cost)
        self.record_ticket(elapsed)
        self.record_trade(elapsed, "team", player["name"], "buy" if cash_order else action, side, quantity, cost)
        if order_id is not None:
            self.executed[key, order_id] = signature

    def host_action(self, action):
        self.update()
        if action == "reset":
            self.reset()
        elif action == "start" and self.phase == "lobby":
            self.phase, self.started = "trading", self.clock()
        elif action == "network" and self.phase in ("settled", "discussion", "network"):
            self.phase, self.network_started = "network", self.clock()
        elif action == "discussion" and self.phase in ("network", "settled", "discussion"):
            self.phase = "discussion"
        else:
            raise GameError("That control is unavailable at this stage.", 409)

    def state(self, key, host, join_url):
        self.update()
        elapsed = 0 if self.started is None else min(self.duration, self.clock() - self.started)
        cutoff = elapsed * 240 / self.duration
        visible = [p for p in self.prices if p["minute"] <= cutoff]
        revealed = self.winner is not None
        up = self.probability("up") * PAYOUT

        def balance(p):
            if revealed:
                return money(p["cash"] + p[self.winner] * PAYOUT)
            return money(p["cash"] + self.cash_out_value(p))

        player = self.players.get(key)
        net_elapsed = 0 if self.network_started is None else min(NETWORK_DURATION, self.clock() - self.network_started)
        if self.phase == "discussion":
            net_elapsed = NETWORK_DURATION
        blocks = [] if self.phase not in ("network", "discussion") else [
            b for b in self.blocks if b["minute"] <= net_elapsed * 240 / NETWORK_DURATION]
        quote_totals = {
            action + side.title(): [money(abs(self.quote(side, sign * n))) for n in range(1, MAX_ORDER + 1)]
            for side in ("up", "down") for action, sign in (("buy", 1), ("sell", -1))
        }
        return {
            "phase": self.phase, "roundId": self.round_id, "host": host, "joinUrl": join_url,
            "remaining": math.ceil(self.duration - elapsed), "elapsed": elapsed,
            "duration": self.duration, "prices": visible, "startPrice": self.prices[0]["price"],
            "lastPrice": visible[-1]["price"], "upPrice": money(up), "downPrice": money(PAYOUT - up),
            "quotes": {key: totals[0] for key, totals in quote_totals.items()},
            "quoteTotals": quote_totals,
            "bulk": self.bulk_quotes(player) if player and not revealed else None,
            "npcCount": NPC_COUNT, "npcTrades": self.npc_trades, "ticketHistory": list(self.ticket_history),
            "tradeFeed": list(self.trade_feed),
            "support": {side: sum(p[side] > 0 for p in self.players.values()) for side in ("up", "down")},
            "players": len(self.players), "me": None if player is None else {
                **player, "cash": money(player["cash"]), "points": balance(player)},
            "rankings": sorted([{"name": p["name"], "points": balance(p)} for p in self.players.values()],
                               key=lambda r: -r["points"]),
            "reveal": {"startUtc": utc(self.start), "endUtc": utc(self.end), "winner": self.winner,
                       "blockCount": len(self.blocks), "txCount": sum(b["transactions"] for b in self.blocks),
                       "source": self.data["priceSource"], "blockSource": self.data["blockSource"]} if revealed else None,
            "network": {"elapsed": net_elapsed, "duration": NETWORK_DURATION, "blocks": blocks,
                        "txCount": sum(b["transactions"] for b in blocks)},
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "BitcoinReplay/1.0"

    def log_message(self, format, *args):
        # Requests include a one-time host entry URL and frequent state polls.
        pass

    def reply(self, status, body=b"", mime="application/json", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def identity(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except CookieError:
            pass
        def get(name):
            record = cookies.get(name)
            return record.value if record else ""
        return get("br_player"), secrets.compare_digest(get("br_host").encode(), self.server.host_key.encode())

    def snapshot(self, key, host, headers=None):
        state = self.server.room.state(key, host, self.server.join_url)
        self.reply(200, json.dumps(state, allow_nan=False).encode(), headers=headers)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/host/"):
            token = path.removeprefix("/host/").encode()
            if ipaddress.ip_address(self.client_address[0]).is_loopback and secrets.compare_digest(token, self.server.host_key.encode()):
                self.reply(303, headers={"Location": "/", "Set-Cookie": self.cookie("br_host", self.server.host_key)})
            else:
                self.reply(403, b'{"error":"Host link is for the presenting computer."}')
            return
        if path == "/api/state":
            with self.server.room.lock:
                self.snapshot(*self.identity())
            return
        name = "index.html" if path == "/" else path[1:]
        if name in ASSETS and (ROOT / name).is_file():
            self.reply(200, (ROOT / name).read_bytes(), mimetypes.guess_type(name)[0] or "application/octet-stream")
        else:
            self.reply(404, b'{"error":"Page not found."}')

    def cookie(self, name, value):
        return f"{name}={value}; HttpOnly; SameSite=Strict; Path=/"

    def do_POST(self):
        room = self.server.room
        try:
            if self.headers.get_content_type() != "application/json":
                raise GameError("Use application/json.", 415)
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host"):
                raise GameError("Cross-origin request refused.", 403)
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise GameError("Invalid request size.", 413)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise GameError("Expected a JSON object.")
            path = urlparse(self.path).path
            key, host = self.identity()
            headers = {}
            with room.lock:
                if path == "/api/join":
                    key = room.join(payload.get("name"), key)
                    headers["Set-Cookie"] = self.cookie("br_player", key)
                elif path == "/api/trade":
                    room.trade(key, payload.get("side"), payload.get("action"), payload.get("quantity", 1),
                               payload.get("orderId"), payload.get("quoteLimit"), payload.get("amount"), payload.get("minQuantity"))
                elif path == "/api/host":
                    if not host:
                        raise GameError("Only the host can use this control.", 403)
                    room.host_action(payload.get("action"))
                else:
                    raise GameError("Unknown endpoint.", 404)
                self.snapshot(key, host, headers)
        except (ValueError, UnicodeError):
            self.reply(400, b'{"error":"Invalid request data."}')
        except GameError as exc:
            self.reply(exc.status, json.dumps({"error": str(exc)}).encode())


def local_ip():
    # Determine the interface used for outgoing traffic. No packets are sent by UDP connect.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
        except OSError:
            return socket.getfqdn()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5188)
    parser.add_argument("--join-url", default=None, help="Public-facing URL displayed to students")
    args = parser.parse_args()
    data = json.loads((ROOT / "history.json").read_text())
    room = Room(data)
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.room = room
    server.host_key = secrets.token_urlsafe(32)
    address = local_ip() if args.bind == "0.0.0.0" else args.bind
    port = server.server_port
    server.join_url = args.join_url or f"http://{address}:{port}/"
    print(f"Host: http://127.0.0.1:{port}/host/{server.host_key}\nStudents: {server.join_url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
