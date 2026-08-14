import json
import sys
import unittest
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SITE_DIR.parent
sys.path.insert(0, str(SITE_DIR))
sys.path.insert(0, str(REPO_ROOT))

from pybridge.bridge import run_request


class BrowserBridgeTest(unittest.TestCase):
    def test_seeded_request_returns_compact_positive_result(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))

        self.assertEqual(result["duration"], 10)
        self.assertGreater(result["squadTotal"], 0)
        self.assertGreater(result["hitCount"], 0)
        self.assertEqual(list(result["charTotals"]), ["리타"])

    def test_character_overrides_are_forwarded_to_the_engine(self):
        payload = {
            "squad": ["리타"],
            "characters": {
                "리타": {
                    "overload": {"atk_pct": 100},
                    "cube": {"name": "파츠", "level": 1},
                    "manualStats": {"normal_atk_dmg_pct": 20},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": True,
            "seed": 42,
        }
        base = dict(payload)
        base.pop("characters")

        customized = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        baseline = json.loads(run_request(json.dumps(base, ensure_ascii=False)))

        self.assertGreater(customized["squadTotal"], baseline["squadTotal"])

    def test_rejects_character_settings_outside_the_squad(self):
        payload = {
            "squad": ["리타"],
            "characters": {"라피": {"cube": {"name": "재장", "level": 15}}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "스쿼드에 없는 캐릭터"):
            run_request(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
