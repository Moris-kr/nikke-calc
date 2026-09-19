import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'site')]
from pybridge.bridge import _build_timeline, run_request
from calculator.sim_result import BurstLogEntry, SimLog


class FullBurstSummaryTest(unittest.TestCase):
    def timeline(self, duration, events):
        return _build_timeline(SimpleNamespace(duration=duration, hits=[],
            log=SimLog(burst_log=events)), [])

    def test_final_open_interval_is_counted_and_clipped(self):
        timeline = self.timeline(12, [BurstLogEntry(8, 'full_burst 시작', '', 18)])
        self.assertEqual(timeline['fullBurst'], [[8, 12]])
        self.assertEqual(timeline['fullBurstSummary'], {
            'count': 1, 'lastStart': 8, 'lastDuration': 4,
            'lastPlannedDuration': 10, 'lastTruncated': True})

    def test_shortened_full_burst_is_not_truncation(self):
        timeline = self.timeline(12, [BurstLogEntry(2, 'full_burst 시작', '', 7),
                                      BurstLogEntry(7, 'full_burst 종료', '')])
        self.assertEqual(timeline['fullBurstSummary']['lastDuration'], 5)
        self.assertFalse(timeline['fullBurstSummary']['lastTruncated'])

    def test_no_burst_and_exact_end(self):
        self.assertEqual(self.timeline(12, [])['fullBurstSummary']['count'], 0)
        timeline = self.timeline(12, [BurstLogEntry(2, 'full_burst 시작', '', 12)])
        self.assertFalse(timeline['fullBurstSummary']['lastTruncated'])

    def test_partial_edit_preserves_default_growth_and_cube_override(self):
        base = {'squad': ['신 : 스위프트 바니'], 'duration': 2, 'enemyDef': 31784,
                'enemyCode': '', 'corePx': 0, 'hasParts': False, 'seed': 42}
        def effective(characters):
            return json.loads(run_request(json.dumps({**base, 'characters': characters}),
                                          include_effective=True))['effectiveCharacters'][0]
        original = effective({})
        changed = effective({'신 : 스위프트 바니': {'growthStage': 0}})
        for key in ['skill_levels', 'equipment', 'cube', 'collection_stage']:
            self.assertEqual(original[key], changed[key], key)
        changed = effective({'신 : 스위프트 바니': {'cube': {'name': '없음', 'level': 0}}})
        self.assertEqual(changed['cube']['name'], '없음')
        self.assertEqual(original['equipment'], changed['equipment'])


if __name__ == '__main__':
    unittest.main()
