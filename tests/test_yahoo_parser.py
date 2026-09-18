import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from server import blend_seasons, find_games, parse_players


class YahooParserTests(unittest.TestCase):
    def test_extracts_games_from_yahoo_list_shape(self):
        payload = {"fantasy_content": {"games": {"0": {"game": [[{"game_key": "450"},
                    {"code": "nba"}, {"season": "2025"}]]}}}}
        self.assertEqual(find_games(payload), [{"key": "450", "season": "2025"}])

    def test_flattens_yahoo_player_shape_and_converts_totals(self):
        payload = {"fantasy_content": {"league": [{"players": {"0": {"player": [
            [{"player_key": "449.p.1"}, {"name": {"full": "Test Player"}},
             {"editorial_team_abbr": "TST"}, {"eligible_positions": [{"position": "PG"}, {"position": "SG"}]}],
            {"player_stats": {"stats": [{"stat": {"stat_id": "0", "value": "10"}},
                                          {"stat": {"stat_id": "12", "value": "250"}},
                                          {"stat": {"stat_id": "9", "value": "30"}}]}}
        ]}}}]}}
        players = parse_players(payload)
        self.assertEqual(len(players), 1)
        self.assertEqual(players[0]["name"], "Test Player")
        self.assertEqual(players[0]["positions"], ["PG", "SG"])
        self.assertEqual(players[0]["stats"]["pts"], 25)
        self.assertEqual(players[0]["stats"]["three_pm"], 3)

    def test_blends_two_seasons_65_35(self):
        latest = {"id": "1", "name": "Player", "games": 70, "stats": {"pts": 20}, "positions": ["PG"]}
        older = {"id": "1", "name": "Player", "games": 60, "stats": {"pts": 10}, "positions": ["PG"]}
        player = blend_seasons([("2025", [latest]), ("2024", [older])])[0]
        self.assertEqual(player["stats"]["pts"], 16.5)
        self.assertEqual([item["season"] for item in player["season_history"]], ["2025", "2024"])


if __name__ == "__main__":
    unittest.main()
