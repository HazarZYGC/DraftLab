import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

import server


class AIPlanTests(unittest.TestCase):
    def setUp(self):
        self.context = {
            "open_roster_slots": ["PG"],
            "numeric_plan": [{"id": "p1", "name": "Player One", "slot": "PG"}],
            "candidates": [{
                "id": "p1", "name": "Player One", "positions": ["PG"],
                "numeric_ceiling": 10, "legal_max": 20, "projection_only": False,
            }],
        }

    @staticmethod
    def response(text):
        return {"model": "test-model", "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("server.post_json")
    def test_retries_truncated_json(self, post_json):
        valid = json.dumps({
            "summary": "Oyuncu odaklı plan.", "recommended_roster": ["p1"],
            "priorities": [{"player_id": "p1", "priority_adjustment": 4, "bid_adjustment": 2,
                            "reason": "Sağlıklı ve üretken.", "sources": []}],
        })
        post_json.side_effect = [self.response('{"summary":"yarım'), self.response(valid)]

        result = server.openai_plan(self.context)

        self.assertEqual(post_json.call_count, 2)
        self.assertFalse(result["fallback_used"])
        self.assertEqual(result["recommended_roster"], ["p1"])
        self.assertEqual(result["priorities"][0]["recommended_max"], 12)

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("server.post_json")
    def test_keeps_numeric_plan_when_both_json_responses_are_truncated(self, post_json):
        post_json.side_effect = [self.response('{"summary":"yarım'), self.response('{"summary":"yine yarım')]

        result = server.openai_plan(self.context)

        self.assertTrue(result["fallback_used"])
        self.assertEqual(result["recommended_roster"], ["p1"])
        self.assertEqual(result["priorities"], [])


if __name__ == "__main__":
    unittest.main()
