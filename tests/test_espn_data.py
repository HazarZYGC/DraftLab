import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from espn_data import (blend_three_seasons, completed_seasons, enrich_with_yahoo_salary,
                       normalized_name, numeric, parse_season, parse_yahoo_salary, yahoo_positions)


PAYLOAD = {
    "categories": [
        {"name": "general", "names": ["gamesPlayed", "avgRebounds"]},
        {"name": "offensive", "names": ["avgPoints", "avgAssists", "avgTurnovers"]},
        {"name": "defensive", "names": ["avgSteals", "avgBlocks"]},
    ],
    "athletes": [{
        "athlete": {"id": "1", "displayName": "Test Guard", "teamShortName": "TST",
                    "position": {"abbreviation": "G"}, "status": {"name": "Active"}},
        "categories": [
            {"name": "general", "values": [70, 5]},
            {"name": "offensive", "values": [20, 8, 3]},
            {"name": "defensive", "values": [1.5, .5]},
        ],
    }],
}


class EspnDataTests(unittest.TestCase):
    def test_completed_seasons_use_espn_end_year(self):
        self.assertEqual(completed_seasons(datetime(2026, 10, 1)), [2026, 2025, 2024])
        self.assertEqual(completed_seasons(datetime(2027, 2, 1)), [2026, 2025, 2024])

    def test_position_mapping(self):
        self.assertEqual(yahoo_positions("G"), ["PG", "SG"])
        self.assertEqual(yahoo_positions("F-C"), ["SF", "PF", "C"])

    def test_parses_espn_categories(self):
        player = parse_season(PAYLOAD, 2026)[0]
        self.assertEqual(player["games"], 70)
        self.assertEqual(player["stats"]["pts"], 20)
        self.assertEqual(player["positions"], ["PG", "SG"])

    def test_three_season_blend_and_missed_rate(self):
        seasons = []
        for season, games, points in ((2026, 70, 20), (2025, 60, 10), (2024, 50, 5)):
            payload = {**PAYLOAD, "athletes": [{**PAYLOAD["athletes"][0], "categories": [
                {"name": "general", "values": [games, 5]},
                {"name": "offensive", "values": [points, 8, 3]},
                {"name": "defensive", "values": [1.5, .5]},
            ]}]}
            seasons.append((season, parse_season(payload, season)))
        player = blend_three_seasons(seasons)[0]
        self.assertEqual(player["stats"]["pts"], 14)
        self.assertEqual(player["games"], 63)
        self.assertGreater(player["missed_game_rate"], .2)
        self.assertEqual(player["history_confidence"], 1)

    def test_one_season_player_gets_history_penalty(self):
        player = blend_three_seasons([(2026, parse_season(PAYLOAD, 2026))])[0]
        self.assertEqual(player["history_seasons"], 1)
        self.assertEqual(player["history_confidence"], .72)

    def test_yahoo_salary_matches_accented_names(self):
        self.assertEqual(numeric("-"), 0)
        payload = {"fantasy_content": {"league": {"players": [{"player": {
            "player_id": "5352", "name": {"full": "Nikola Jokić"},
            "eligible_positions": [{"position": "C"}, {"position": "Util"}],
            "projected_auction_value": "61", "draft_analysis": {"average_cost": "71.0", "percent_drafted": "1.0"},
            "player_ranks": [{"player_rank": {"rank_value": "1"}}],
        }}]}}}
        salaries = parse_yahoo_salary(payload)
        players = enrich_with_yahoo_salary([{"name": "Nikola Jokic", "positions": ["C"]}], salaries)
        self.assertEqual(normalized_name("Nikola Jokić"), "nikolajokic")
        self.assertEqual(players[0]["yahoo_average_salary"], 71.0)
        self.assertEqual(players[0]["yahoo_projected_salary"], 61.0)


if __name__ == "__main__":
    unittest.main()
