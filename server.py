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
from datetime import datetime, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent / "public"
ASSETS = {"index.html", "app.js", "style.css"}
PAYOUT = 10
STARTING_CASH = 100
LIQUIDITY = 40
NETWORK_DURATION = 60


class GameError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def money(value):
    return round(value, 4)


class Room:
    def __init__(self, data, duration=300, clock=time.monotonic):
        self.data = data
        self.duration = duration
        self.clock = clock
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
        self.round_id = secrets.token_hex(5)

    def update(self):
        if self.phase == "trading" and self.clock() - self.started >= self.duration:
            self.phase = "settled"
            self.winner = "up" if self.prices[-1]["price"] > self.prices[0]["price"] else "down"

    def join(self, name, existing):
        self.update()
        if existing in self.players:
            return existing
        if self.phase not in ("lobby", "trading"):
            raise GameError("This round has closed.", 409)
        if not isinstance(name, str):
            raise GameError("Enter a team name.")
        name = " ".join(name.split())
        if not 1 <= len(name) <= 24 or not name.isprintable():
            raise GameError("Use a team name between 1 and 24 characters.")
        if any(p["name"].casefold() == name.casefold() for p in self.players.values()):
            raise GameError("That team name is taken.", 409)
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
        # LMSR cost difference, evaluated without exponentiating outstanding quantities.
        return PAYOUT * LIQUIDITY * math.log1p(self.probability(side) * math.expm1(delta / LIQUIDITY))

    def trade(self, key, side, action, quantity, order_id=None):
        self.update()
        if order_id is not None:
            if not isinstance(order_id, str) or not 1 <= len(order_id) <= 64:
                raise GameError("Invalid trade reference.")
            previous = self.executed.get((key, order_id))
            if previous is not None:
                if previous != (side, action, quantity):
                    raise GameError("Trade reference already used for a different order.", 409)
                return
        if self.phase != "trading":
            raise GameError("Trading is closed.", 409)
        if key not in self.players:
            raise GameError("Join the room first.", 403)
        if side not in ("up", "down") or action not in ("buy", "sell"):
            raise GameError("Choose Buy or Sell and a side.")
        if type(quantity) is not int or not 1 <= quantity <= 10:
            raise GameError("Choose 1 to 10 tickets per order.")
        player = self.players[key]
        delta = quantity if action == "buy" else -quantity
        cost = self.quote(side, delta)
        if delta < 0 and player[side] < quantity:
            raise GameError("You can only sell tickets you own.", 409)
        if delta > 0 and cost > player["cash"] + 1e-9:
            raise GameError("You need more points for this trade.", 409)
        player["cash"] = max(0, player["cash"] - cost)
        player[side] += delta
        self.units[side] += delta
        if order_id is not None:
            self.executed[key, order_id] = (side, action, quantity)

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
            return money(p["cash"] + p["up"] * up + p["down"] * (PAYOUT - up))

        player = self.players.get(key)
        net_elapsed = 0 if self.network_started is None else min(NETWORK_DURATION, self.clock() - self.network_started)
        if self.phase == "discussion":
            net_elapsed = NETWORK_DURATION
        blocks = [] if self.phase not in ("network", "discussion") else [
            b for b in self.blocks if b["minute"] <= net_elapsed * 240 / NETWORK_DURATION]
        return {
            "phase": self.phase, "roundId": self.round_id, "host": host, "joinUrl": join_url,
            "remaining": math.ceil(self.duration - elapsed), "elapsed": elapsed,
            "duration": self.duration, "prices": visible, "startPrice": self.prices[0]["price"],
            "lastPrice": visible[-1]["price"], "upPrice": money(up), "downPrice": money(PAYOUT - up),
            "quotes": {action + side.title(): money(abs(self.quote(side, delta)))
                       for side in ("up", "down") for action, delta in (("buy", 1), ("sell", -1))},
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
                    room.trade(key, payload.get("side"), payload.get("action"), payload.get("quantity", 1), payload.get("orderId"))
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
