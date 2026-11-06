import json
import socket
import sys
import unittest
from pathlib import Path
from threading import Thread
from types import SimpleNamespace

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from server import Handler, Room


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.server = SimpleNamespace(
            host_key="test-host-key", join_url="http://class.local/",
            room=Room(json.loads((PROJECT / "public" / "history.json").read_text()), clock=lambda: self.now),
        )

    def request(self, path, payload=None, cookie="", origin="", client="127.0.0.1"):
        # Use connected sockets to test real HTTP parsing without publishing a test port.
        sender, receiver = socket.socketpair()
        def serve_one():
            with receiver:
                Handler(receiver, (client, 1234), self.server)
        thread = Thread(target=serve_one)
        thread.start()
        body = json.dumps(payload).encode() if payload is not None else b""
        verb = "POST" if payload is not None else "GET"
        headers = [f"{verb} {path} HTTP/1.1", "Host: class.local", "Connection: close",
                   "Content-Type: application/json", f"Content-Length: {len(body)}"]
        if cookie: headers.append("Cookie: " + cookie)
        if origin: headers.append("Origin: " + origin)
        with sender:
            sender.sendall(("\r\n".join(headers) + "\r\n\r\n").encode() + body)
            response = bytearray()
            while True:
                chunk = sender.recv(8192)
                if not chunk: break
                response.extend(chunk)
        thread.join()
        raw_headers, raw_body = bytes(response).split(b"\r\n\r\n", 1)
        lines = raw_headers.decode().split("\r\n")
        code = int(lines[0].split(" ")[1])
        result_headers = dict(line.split(": ", 1) for line in lines[1:])
        return code, result_headers, json.loads(raw_body) if raw_body else None

    def test_multidevice_round_and_private_host_actions(self):
        code, headers, _ = self.request("/host/test-host-key")
        self.assertEqual(code, 303)
        host = headers["Set-Cookie"].split(";", 1)[0]
        self.assertEqual(self.request("/host/test-host-key", client="192.168.10.1")[0], 403)
        code, headers, state = self.request("/api/join", {"name":"Eli"}, client="192.168.1.3")
        player = headers["Set-Cookie"].split(";", 1)[0]
        self.assertEqual((code, state["host"], state["players"]), (200, False, 1))
        self.assertEqual(self.request("/api/host", {"action":"start"}, player)[0], 403)
        self.assertEqual(self.request("/api/host", {"action":"start"}, host, "https://elsewhere.example")[0], 403)
        self.assertEqual(self.request("/api/host", {"action":"start"}, host)[2]["phase"], "trading")
        self.assertEqual(self.request("/history.json")[0], 404)
        order = {"side":"up", "action":"buy", "quantity":2, "orderId":"test-order"}
        code, _, state = self.request("/api/trade", order, player)
        self.assertEqual((code, state["me"]["up"]), (200, 2))
        self.assertEqual(self.request("/api/trade", order, player)[2]["me"], state["me"])
        self.assertEqual(self.request("/api/trade", dict(order, quantity=1), player)[0], 409)
        self.now = 300
        self.assertEqual(self.request("/api/state", cookie=player)[2]["phase"], "settled")
        self.assertEqual(self.request("/api/host", {"action":"network"}, host)[2]["phase"], "network")
        self.now += 61
        self.assertEqual(self.request("/api/state", cookie=player)[2]["network"]["txCount"], 53191)
        self.assertEqual(self.request("/api/host", {"action":"discussion"}, host)[2]["phase"], "discussion")


if __name__ == "__main__":
    unittest.main()
