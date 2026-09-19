import unittest

from nikke_mcp.models import BattleOptions, RecommendationScenario


class OptimalRangeSchemaTest(unittest.TestCase):
    def test_round_trip_and_recommendation(self):
        windows = [{"from": 1, "to": 2, "weapons": []}]
        self.assertEqual(BattleOptions(optimalRangeWindows=windows).model_dump()["optimalRangeWindows"], windows)
        RecommendationScenario(label="range", battle={"optimalRangeWindows": windows})
        self.assertEqual(BattleOptions().optimalRangeWindows, [])

    def test_invalid_windows(self):
        for window in [{"from": 2, "to": 1, "weapons": []},
                       {"from": 0, "to": float("inf"), "weapons": []},
                       {"from": 0, "to": 1, "weapons": ["unknown"]},
                       {"from": 0, "to": 1}]:
            with self.subTest(window=window), self.assertRaises(ValueError):
                BattleOptions(optimalRangeWindows=[window])
