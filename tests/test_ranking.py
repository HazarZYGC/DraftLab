import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from ranking import rank_players, recommendation_score


class RankingTests(unittest.TestCase):
    def setUp(self):
        self.players = [
            {"id": "a", "name": "All Around", "positions": ["PG", "SG"], "status": "Healthy", "games": 20,
             "stats": {"pts": 25, "reb": 6, "ast": 8, "stl": 2, "blk": 1, "tov": 2, "three_pm": 3, "fg_pct": .52, "ft_pct": .88, "fga": 18, "fta": 7}},
            {"id": "b", "name": "Risky", "positions": ["C"], "status": "OUT", "games": 20,
             "stats": {"pts": 18, "reb": 10, "ast": 2, "stl": .5, "blk": 2, "tov": 4, "three_pm": 0, "fg_pct": .50, "ft_pct": .62, "fga": 14, "fta": 5}},
        ]

    def test_category_ranking_prefers_broad_contribution(self):
        ranked = rank_players(self.players, "categories")
        self.assertEqual(ranked[0]["id"], "a")
        self.assertEqual([player["rank"] for player in ranked], [1, 2])

    def test_injury_penalty_is_applied(self):
        risky = next(player for player in rank_players(self.players, "categories") if player["id"] == "b")
        self.assertEqual(risky["risk_penalty"], 1.6)
        self.assertLess(risky["score"], risky["base_score"])

    def test_fit_rewards_missing_position(self):
        ranked = rank_players(self.players, "categories")
        center = next(player for player in ranked if player["id"] == "b")
        score, reasons = recommendation_score(center, [ranked[0]], 4)
        self.assertGreater(score, center["score"])
        self.assertTrue(any("C eksiğini" in reason for reason in reasons))

    def test_points_score_uses_yahoo_weights_without_three_point_bonus(self):
        player = {**self.players[0], "availability": 1}
        ranked = rank_players([player], "points")
        expected = 25 + 6 * 1.2 + 8 * 1.5 + 2 * 3 + 1 * 3 - 2
        self.assertEqual(ranked[0]["fantasy_ppg"], expected)

    def test_missed_games_reduce_points_value(self):
        healthy = {**self.players[0], "id": "healthy", "availability": 1}
        risky = {**self.players[0], "id": "risky", "availability": .7}
        ranked = rank_players([healthy, risky], "points")
        scores = {player["id"]: player["score"] for player in ranked}
        self.assertGreater(scores["healthy"], scores["risky"])
        self.assertAlmostEqual(next(p for p in ranked if p["id"] == "risky")["availability_multiplier"], .82)


if __name__ == "__main__":
    unittest.main()
