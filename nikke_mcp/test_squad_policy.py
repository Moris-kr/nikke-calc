import unittest
from unittest.mock import patch

from nikke_mcp.squad_policy import inspect_squad_policy, query_squad_roles


class SquadPolicyTests(unittest.TestCase):
    def squad(self, first='리타'):
        return [first, '크라운', '신데렐라', '홍련 : 흑영', '나가']

    def test_positive_team_cdr_is_required(self):
        result = inspect_squad_policy(self.squad())
        self.assertTrue(result['recommendedEligible'])
        self.assertEqual(result['providers'], ['리타'])
        self.assertFalse(inspect_squad_policy(self.squad('미란다'))['allowed'])

    def test_self_reduction_and_negative_reduction_are_not_providers(self):
        for name in ('레드 후드', '프리카'):
            result = inspect_squad_policy(self.squad(name))
            self.assertEqual(result['providers'], [])
            self.assertFalse(result['recommendedEligible'])

    def test_explicit_consent_only_allows_user_fixed_simulation(self):
        squad = self.squad('미란다')
        self.assertTrue(inspect_squad_policy(squad, purpose='user_fixed')['requiresConfirmation'])
        accepted = inspect_squad_policy(squad, purpose='user_fixed', allow_no_cdr=True)
        self.assertTrue(accepted['allowed'])
        self.assertFalse(accepted['recommendedEligible'])
        self.assertFalse(inspect_squad_policy(squad, allow_no_cdr=True)['allowed'])

    def test_anis_and_rapi_with_other_b1_do_not_provide_team_cdr(self):
        for name in ('아니스 : 스타', '라피 : 레드 후드'):
            squad = self.squad(name)
            self.assertIn(name, inspect_squad_policy(squad)['providers'])
            squad[-1] = '미란다'
            self.assertEqual(inspect_squad_policy(squad)['providers'], [])

    def test_anis_with_rapi_keeps_anis_cdr_and_rapi_stage_three(self):
        squad = ['아니스 : 스타', '크라운', '라피 : 레드 후드',
                 '스노우 화이트 : 헤비암즈', '마스트 : 로망틱 메이드']
        result = inspect_squad_policy(squad)
        self.assertEqual(result['providers'], ['아니스 : 스타'])
        self.assertTrue(result['recommendedEligible'])
        self.assertIn('라피 : 레드 후드', result['burstStageCoverage']['3'])
        self.assertEqual(result['conditional'], [])

    def test_reentry_only_stage_cannot_complete_burst_chain(self):
        squad = ['티아', '헬름 : 아쿠아마린', '신데렐라', '홍련 : 흑영', '나가']
        result = inspect_squad_policy(squad)
        self.assertIn('missing_burst_stage_exit_1', result['constraints'])
        self.assertFalse(result['recommendedEligible'])
        squad[-1] = '리타'
        self.assertTrue(inspect_squad_policy(squad)['recommendedEligible'])

    def test_favorite_stage_selects_actual_effects(self):
        squad = self.squad('목단')
        self.assertIn('목단', inspect_squad_policy(squad)['providers'])
        result = inspect_squad_policy(squad, {'목단': {'collection': {'stage': 'SR15', 'favorite': 0}}})
        self.assertEqual(result['providers'], [])
        self.assertFalse(result['recommendedEligible'])

    def test_manual_tap_fire_does_not_guarantee_full_charge_cdr(self):
        squad = self.squad('D : 킬러 와이프')
        self.assertTrue(inspect_squad_policy(squad)['recommendedEligible'])
        result = inspect_squad_policy(squad, {'D : 킬러 와이프': {'control': {'tap_fire': {'rate': 3.6}}}})
        self.assertFalse(result['recommendedEligible'])
        self.assertTrue(result['conditional'])

    def test_selected_skill_level_is_used(self):
        result = inspect_squad_policy(self.squad('D : 킬러 와이프'),
                                      {'D : 킬러 와이프': {'skillLevels': {'2': 1}}})
        self.assertEqual(result['cdrEffects'][0]['seconds'], 4.13)

    def test_restricted_positive_and_negative_team_effects_do_not_pass(self):
        for target, value in [('allies_burst3', 7), ('all_allies', -21), ('self', 40)]:
            effect = {'stat': 'burst_cooldown_reduce', 'target': target, 'fixed_value': value,
                      'trigger': {'timing': ['full_burst_start'], 'condition': []}}
            with patch('nikke_mcp.squad_policy.char_effects', return_value=[effect]):
                self.assertFalse(inspect_squad_policy(self.squad())['recommendedEligible'])

    def test_arbitrary_unknown_state_is_not_effective(self):
        effect = {'stat': 'burst_cooldown_reduce', 'target': 'all_allies', 'fixed_value': 7,
                  'trigger': {'timing': ['full_burst_start'], 'condition': ['self_state:unknown']}}
        with patch('nikke_mcp.squad_policy.char_effects', return_value=[effect]):
            result = inspect_squad_policy(self.squad())
        self.assertEqual(result['providers'], [])
        self.assertTrue(result['conditional'])

    def test_soda_exception_requires_shotgun_archetype(self):
        squad = ['토브', '나유타', '소다 : 트윙클링 바니', '도로시 : 세렌디피티', '드레이크']
        result = inspect_squad_policy(squad)
        self.assertTrue(result['recommendedEligible'])
        self.assertEqual(result['exception'], 'soda_shotgun_fullburst_extension')
        arbitrary = self.squad('미란다')
        arbitrary[2] = '소다 : 트윙클링 바니'
        self.assertFalse(inspect_squad_policy(arbitrary)['recommendedEligible'])
        self.assertFalse(inspect_squad_policy(squad, {'소다 : 트윙클링 바니': {'burst': {'mode': 'skip'}}})['recommendedEligible'])

    def test_five_unique_members_and_stage_coverage(self):
        for squad in (self.squad()[:4], ['리타'] * 5,
                      ['리타', '신데렐라', '홍련 : 흑영', '앨리스', '모더니아']):
            self.assertFalse(inspect_squad_policy(squad, purpose='user_fixed', allow_no_cdr=True)['allowed'])
        self.assertFalse(inspect_squad_policy(self.squad(), {'크라운': {'burst': {'mode': 'skip'}},
                                                          '나가': {'burst': {'mode': 'skip'}}})['allowed'])

    def test_one_b3_is_not_automatically_rejected(self):
        result = inspect_squad_policy(['리타', '크라운', '이사벨', '나가', '토브'])
        self.assertTrue(result['recommendedEligible'])

    def test_roles_are_candidates_not_composition_guarantees(self):
        roles = query_squad_roles(['리타', '레드 후드', '프리카', '아니스 : 스타'])['characters']
        self.assertEqual([r['teamCdrCandidate'] for r in roles], [True, False, False, True])
        self.assertTrue(roles[-1]['requiresSquadValidation'])


if __name__ == '__main__':
    unittest.main()
