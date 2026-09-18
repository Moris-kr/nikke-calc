import unittest

from pydantic import ValidationError
from nikke_mcp.models import CombatRequest


class DefenseRateSchemaTest(unittest.TestCase):
    def test_round_trip_and_default_rate(self):
        request = CombatRequest(squad=['리타'], defenseRateWindows=[{'from': 30, 'to': 60}])
        self.assertEqual(request.model_dump()['defenseRateWindows'],
                         [{'from': 30, 'to': 60, 'rate': 60}])
        self.assertEqual(CombatRequest(squad=['리타']).defenseRateWindows, [])

    def test_invalid_windows(self):
        for window in [{'from': 60, 'to': 30}, {'from': -1, 'to': 30},
                       {'from': 0, 'to': 181}, {'from': 0, 'to': 30, 'rate': -1},
                       {'from': 0, 'to': 30, 'rate': 101},
                       {'from': 0, 'to': 30, 'rate': float('nan')}]:
            with self.subTest(window=window), self.assertRaises(ValidationError):
                CombatRequest(squad=['리타'], defenseRateWindows=[window])


if __name__ == '__main__':
    unittest.main()
