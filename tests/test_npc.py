import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from server import NPC_COUNT, Room


class MarketReplayTest(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.history = json.loads((PROJECT / "public/history.json").read_text())

    def room(self, history=None):
        return Room(history or self.history, clock=lambda: self.now, seed=31719)

    def view(self, room):
        return room.state("", False, "/")

    def test_polling_does_not_move_the_market_twice_or_depend_on_the_future(self):
        changed = deepcopy(self.history)
        # After one replay minute only the first 48 historical minutes have played.
        for candle in changed["prices"][49:]:
            candle["price"] *= 1.5
        busy, quiet, different_future = self.room(), self.room(), self.room(changed)
        for room in (busy, quiet, different_future):
            self.assertEqual(self.view(room)["npcTrades"], 0)
            room.host_action("start")
        for millis in range(0, 60_000, 250):
            self.now = millis / 1000
            self.view(busy)
        self.now = 60
        views = [self.view(room) for room in (busy, quiet, different_future)]
        for view in views:
            self.assertEqual(view["players"], 0)
            self.assertEqual(view["rankings"], [])
            self.assertEqual(view["npcCount"], NPC_COUNT)
            self.assertGreater(view["npcTrades"], 40)
            self.assertEqual(view["ticketHistory"], views[0]["ticketHistory"])
            self.assertEqual(view["ticketHistory"][-1]["price"], view["quotes"]["buyUp"])
        self.assertEqual(self.view(quiet)["npcTrades"], views[1]["npcTrades"])
        self.assertEqual(self.view(quiet)["ticketHistory"], views[1]["ticketHistory"])

    def test_market_moves_and_settles_without_any_human_trades(self):
        game = self.room()
        warm = self.view(game)
        self.assertLess(warm["ticketHistory"][0]["second"], 0)
        self.assertEqual(warm["ticketHistory"][-1]["second"], 0)
        self.assertEqual(warm["quotes"]["buyUp"], warm["quotes"]["buyDown"])
        self.assertAlmostEqual(warm["quotes"]["buyUp"], 5, delta=0.1)
        game.host_action("start")
        self.now = 300
        closed = self.view(game)
        self.assertEqual(closed["phase"], "settled")
        self.assertGreater(closed["npcTrades"], 200)
        self.assertEqual(closed["players"], 0)
        self.assertGreater(len({p["price"] for p in closed["ticketHistory"]}), 5)
        self.assertEqual(len(game.npcs), 20)
        for key in ("up", "down"):
            self.assertEqual(game.units[key], sum(p[key] for p in game.npcs))
        self.assertTrue(all(min(p["cash"], p["up"], p["down"]) >= 0 for p in game.npcs))
        self.now += 3600
        self.assertEqual(self.view(game)["npcTrades"], closed["npcTrades"])
        game.host_action("reset")
        self.assertEqual(self.view(game)["npcTrades"], 0)

    def test_one_revealed_jump_triggers_a_short_burst(self):
        flat = deepcopy(self.history)
        for p in flat["prices"]:
            p["price"] = 40000
        shock = deepcopy(flat)
        for p in shock["prices"][40:]:
            p["price"] = 44000
        rooms = [self.room(flat), self.room(shock)]
        for room in rooms:
            room.host_action("start")
        self.now = 49
        before = [self.view(room)["npcTrades"] for room in rooms]
        self.assertEqual(*before)
        self.now = 56
        after = [self.view(room)["npcTrades"] for room in rooms]
        self.assertGreater(after[1] - before[1], after[0] - before[0] + 3)
        self.now = 89
        prior = self.view(rooms[1])["npcTrades"]
        self.now = 99
        self.assertLess(self.view(rooms[1])["npcTrades"] - prior, 15)

    def test_large_drop_and_rebound_move_the_executable_ticket_prices(self):
        game = self.room()
        game.host_action("start")
        self.now = 125
        crash = self.view(game)
        self.assertLess(crash["quotes"]["buyUp"], 0.5)
        self.assertGreater(crash["quotes"]["buyDown"], 9.5)
        self.now = 170
        recovery = self.view(game)
        self.assertGreater(recovery["quotes"]["buyUp"], crash["quotes"]["buyUp"] + 1.5)
        self.assertEqual(recovery["quotes"]["buyUp"], recovery["ticketHistory"][-1]["price"])

    def test_human_trades_share_the_quote_line_without_counting_as_bot_fills(self):
        game = self.room()
        team = game.join("Test table", "")
        game.host_action("start")
        self.now = 22
        before = self.view(game)
        game.trade(team, "up", "buy", 5)
        after = self.view(game)
        self.assertEqual(after["players"], 1)
        self.assertEqual(after["npcTrades"], before["npcTrades"])
        self.assertGreater(after["ticketHistory"][-1]["price"], before["quotes"]["buyUp"])
        self.assertEqual(after["ticketHistory"][-1], {
            "second": 22, "price": after["quotes"]["buyUp"], "downPrice": after["quotes"]["buyDown"]})


if __name__ == "__main__":
    unittest.main()
