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


if __name__ == "__main__":
    unittest.main()
