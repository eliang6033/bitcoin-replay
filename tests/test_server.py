import json
import sys
import unittest
from pathlib import Path
from threading import Barrier, Thread

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from server import ASSETS, GameError, Room


class ReplayTest(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        data = json.loads((PROJECT / "public" / "history.json").read_text())
        self.game = Room(data, clock=lambda: self.now)
        self.team = self.game.join("Team Blue", "")

    def state(self):
        return self.game.state(self.team, False, "/")

    def test_no_spoilers_and_time_mapping(self):
        self.assertEqual(1, len(self.state()["prices"]))
        self.assertIsNone(self.state()["reveal"])
        self.assertNotIn("history.json", ASSETS)
        self.game.host_action("start")
        self.now += 60
        self.assertEqual(48, self.state()["prices"][-1]["minute"])
        self.assertEqual([], self.state()["network"]["blocks"])
        self.now += 240
        self.assertEqual(240, self.state()["prices"][-1]["minute"])
        self.assertEqual("settled", self.state()["phase"])
        with self.assertRaises(GameError):
            self.game.trade(self.team, "up", "buy", 1)

    def test_market_impact_cashout_and_invalid_trades(self):
        self.game.host_action("start")
        self.game.trade(self.team, "up", "buy", 3)
        self.assertGreater(self.state()["upPrice"], 5)
        self.game.trade(self.team, "up", "sell", 3)
        self.assertAlmostEqual(100, self.state()["me"]["cash"])
        for action, qty in [("sell", 1), ("buy", -1), ("buy", True), ("buy", 10.1)]:
            with self.assertRaises(GameError):
                self.game.trade(self.team, "up", action, qty)
        self.game.trade(self.team, "down", "buy", 10)
        before = self.state()["me"]
        with self.assertRaises(GameError):
            self.game.trade(self.team, "down", "buy", 10)
        self.assertEqual(before, self.state()["me"])

    def test_final_scores_and_network_match_window(self):
        self.game.host_action("start")
        side = "up" if self.game.prices[-1]["price"] > self.game.prices[0]["price"] else "down"
        self.game.trade(self.team, side, "buy", 3)
        cash = self.state()["me"]["cash"]
        self.now += 301
        self.assertAlmostEqual(cash + 30, self.state()["me"]["points"])
        self.game.host_action("network")
        self.now += 30
        s = self.state()
        self.assertTrue(all(b["minute"] <= 120 for b in s["network"]["blocks"]))
        self.now += 30
        s = self.state()
        self.assertEqual(21, len(s["network"]["blocks"]))
        self.assertEqual(53191, s["network"]["txCount"])
        self.assertEqual(s["reveal"]["txCount"], s["network"]["txCount"])
        self.game.host_action("discussion")
        self.game.host_action("reset")
        self.assertEqual("lobby", self.state()["phase"])
        self.assertIsNone(self.state()["me"])

    def test_rankings_include_inactive_and_late_players_at_settlement(self):
        self.game.prices[-1]["price"] = self.game.prices[0]["price"]
        winner = self.game.join("Ari", "")
        loser = self.game.join("Casey", "")
        self.game.host_action("start")
        self.game.trade(winner, "down", "buy", 2)
        self.game.trade(loser, "up", "buy", 1)
        self.game.trade(winner, "down", "sell", 1)
        self.now += 299
        self.game.join("Lee", "")
        self.now += 1
        final = self.game.state("", False, "/")
        self.assertEqual(final["reveal"]["winner"], "down")
        self.assertEqual((final["players"], final["npcCount"]), (4, 120))
        self.assertEqual([row["name"] for row in final["rankings"]], ["Ari", "Team Blue", "Lee", "Casey"])
        balances = [row["points"] for row in final["rankings"]]
        self.assertAlmostEqual(balances[0], self.game.players[winner]["cash"] + 10, places=3)
        self.assertEqual(balances[1:3], [100, 100])
        self.assertAlmostEqual(balances[3], self.game.players[loser]["cash"], places=3)

    def test_shared_market_multiple_teams_and_concurrent_orders(self):
        red = self.game.join("Team Red", "")
        self.assertEqual(red, self.game.join("Restore", red))
        with self.assertRaises(GameError):
            self.game.join("TEAM RED", "")
        self.game.host_action("start")
        initial_quote = self.state()["quotes"]["buyUp"]
        self.game.trade(red, "up", "buy", 3)
        self.assertGreater(self.state()["quotes"]["buyUp"], initial_quote)
        # Simultaneously spend the same balance under the HTTP handler's lock.
        outcomes = []
        gate = Barrier(4)
        def order():
            gate.wait()
            with self.game.lock:
                try:
                    self.game.trade(self.team, "up", "buy", 10)
                    outcomes.append(True)
                except GameError:
                    outcomes.append(False)
        jobs = [Thread(target=order) for _ in range(4)]
        for job in jobs: job.start()
        for job in jobs: job.join()
        self.assertEqual(1, sum(outcomes))
        self.assertEqual(self.state()["me"]["up"], 10)
        self.assertGreaterEqual(self.state()["me"]["cash"], 0)


if __name__ == "__main__":
    unittest.main()
