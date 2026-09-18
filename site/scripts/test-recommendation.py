"""Bounded search tests; mock expensive simulation, not ranking behavior."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'site')]


class RecommendationTest(unittest.TestCase):
    def setUp(self):
        path = ROOT / 'site/pybridge/recommendation.py'
        self.assertTrue(path.exists(), 'recommendation engine must exist')
        from pybridge import recommendation
        self.module = recommendation

    def run_case(self, teams, scores, **extra):
        candidates = [{'label': str(i), 'squad': team} for i, team in enumerate(teams)]
        roster = {name: {'growthStage': 0, 'skillLevels': {'1': 3}} for team in teams for name in team}
        payload = {'candidates': candidates, 'roster': roster,
                   'battle': {'duration': 30, 'enemyDef': 100, 'seed': 42,
                              'synchroLevel': 321, 'console': {'common_level': 4}}, **extra}
        self.requests = []
        def simulate(raw, include_effective=False):
            req = json.loads(raw)
            self.requests.append(req)
            self.assertTrue(include_effective)
            index = teams.index(req['squad'])
            score = scores[index][0 if req['enemyDef'] == 100 else 1]
            if isinstance(score, Exception):
                raise score
            return json.dumps({'result': {'squadTotal': score, 'duration': 30,
                'timeline': {'fullBurst': [[2, 12], [16, 26]]}, 'deviations': 'actual'},
                'effectiveCharacters': req['characters']})
        with patch.object(self.module, 'run_request', simulate), patch.object(
                self.module, 'inspect_squad_policy', side_effect=lambda names, **kw:
                {'recommendedEligible': 'bad' not in names}), patch.object(
                self.module.char_spec, '_nikke', return_value=roster):
            return json.loads(self.module.run_recommendation(json.dumps(payload)))

    def test_exact_five_decks_avoids_greedy_trap(self):
        teams = [[f'{i}-{j}' for j in range(5)] for i in range(5)]
        trap = [team[0] for team in teams]
        result = self.run_case([trap, *teams], [[150], *[[50]] * 5], squadCount=5)
        self.assertEqual([c['id'] for c in result['selected']], [1, 2, 3, 4, 5])
        self.assertEqual(result['solutions'][0]['baseTotal'], 250)

    def test_regret_changes_ranking_and_preserves_growth(self):
        teams = [list('abcde'), list('fghij')]
        result = self.run_case(teams, [[100, 10], [80, 80]], scenarios=[{'label': 'hard', 'battle': {'enemyDef': 200}}])
        self.assertEqual(result['selected'][0]['id'], 1)
        self.assertEqual(result['solutions'][0]['maxRegret'], .2)
        for req in self.requests:
            self.assertEqual(req['synchroLevel'], 321)
            self.assertEqual(req['console'], {'common_level': 4})
            self.assertEqual(req['rngMode'], 'expected')
            self.assertEqual(req['characters'][req['squad'][0]], {'growthStage': 0, 'skillLevels': {'1': 3}})
        self.assertEqual(result['selected'][0]['scenarios'][0]['diagnostics']['gaps'], [4])

    def test_missing_growth_no_cdr_and_nonfinite_are_skipped(self):
        teams = [list('abcde'), ['bad', 'f', 'g', 'h', 'i'], list('jklmn')]
        roster = {n: {'growthStage': 0} for t in teams for n in t}
        roster['a'] = {}
        result = self.run_case(teams, [[10], [20], [float('inf')]], roster=roster)
        self.assertEqual(result['selected'], [])
        self.assertTrue(all(c['status'] == 'rejected' for c in result['candidates']))

    def test_failed_scenario_does_not_receive_zero_score(self):
        result = self.run_case([list('abcde')], [[10, ValueError('broken')]], scenarios=[{'label': 'hard', 'battle': {'enemyDef': 200}}])
        self.assertEqual(result['selected'], [])
        self.assertIn('broken', result['candidates'][0]['reason'])

    def test_no_feasible_disjoint_group_and_union_include(self):
        result = self.run_case([list('abcde'), list('afghi')], [[20], [10]], squadCount=2)
        self.assertEqual(result['solutions'], [])
        result = self.run_case([list('abcde'), list('fghij')], [[20], [10]], squadCount=2, include=['a', 'j'])
        self.assertEqual(len(result['selected']), 2)

    def test_scenario_cannot_change_account_or_duration(self):
        for key in ['synchroLevel', 'console', 'characters', 'duration']:
            with self.assertRaises(ValueError):
                self.run_case([list('abcde')], [[10]], scenarios=[{'label': 'bad', 'battle': {key: 1}}])

    def test_single_scenario_tie_has_stable_input_order(self):
        result = self.run_case([list('abcde'), list('fghij')], [[10], [10]])
        self.assertEqual(result['selected'][0]['id'], 0)

    def test_exclusion_and_unknown_canonical_names_fail_closed(self):
        result = self.run_case([list('abcde'), list('fghij')], [[100], [10]], exclude=['a'])
        self.assertEqual(result['selected'][0]['id'], 1)
        result = self.run_case([list('abcde')], [[100]], roster={'a': {'growthStage': 0}})
        self.assertEqual(result['selected'], [])

    def test_controls_alone_do_not_count_as_actual_growth(self):
        roster = {name: {'control': {'mode': 'auto'}} for name in 'abcde'}
        result = self.run_case([list('abcde')], [[100]], roster=roster)
        self.assertEqual(result['selected'], [])
        self.assertIn('육성 누락', result['candidates'][0]['reason'])

    def test_zero_scores_have_finite_regret(self):
        result = self.run_case([list('abcde')], [[0]])
        self.assertEqual(result['solutions'][0]['maxRegret'], 0)


if __name__ == '__main__':
    unittest.main()
