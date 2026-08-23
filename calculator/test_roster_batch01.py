from __future__ import annotations

import unittest

from calculator.buff_manager import BuffManager
from calculator.base_stat import calc_base_stats
from calculator.timeline import simulate
from context.spec import build_config, build_squad


class RosterBatch01MechanicsTest(unittest.TestCase):
    def test_aid_attack_buff_starts_only_after_crossing_below_ninety_percent_hp(self):
        squad = build_squad(["에이드"])
        base = calc_base_stats(squad[0])
        state = {
            "enemy": {},
            "base_stats": {"에이드": base},
            "hp": {"에이드": float(base["hp"])},
            "hp_pct": {"에이드": 100.0},
            "stacks": {"에이드": {}},
            "gauges": {"에이드": {}},
        }
        manager = BuffManager(squad, state)
        manager.notify("battle_start", 0.0, "에이드")
        self.assertEqual(manager.get_buffs("에이드", "__enemy__", 0.0)["atk_flat"], 0.0)

        state["hp"]["에이드"] = base["hp"] * 0.89
        manager.sync_hp("에이드")

        self.assertGreater(manager.get_buffs("에이드", "__enemy__", 0.0)["atk_flat"], 0.0)

    def test_each_squad_burst_cast_notifies_winter_rupee(self):
        members = ["루피 : 윈터 쇼퍼", "리틀 머메이드", "크라운", "test_B3", "스노우 화이트 : 헤비암즈"]
        squad = build_squad(members)
        config = build_config(squad, {"first_burst_time": 1.0, "duration": 12.0})

        result = simulate(squad, config=config, verbose=True, seed=1)

        shopping = [
            event for event in result.log.buff_events
            if event.kind == "activate" and event.name == "쇼핑"
        ]
        vip = [
            event for event in result.log.buff_events
            if event.kind == "activate" and event.name == "VIP 기프트"
        ]
        self.assertGreaterEqual(len(shopping), 4)
        self.assertGreaterEqual(len(vip), 1)

    def test_mary_uses_separate_full_burst_and_personal_cast_counters(self):
        squad = build_squad(["메어리 : 베이 갓데스"])
        manager = BuffManager(squad, {"enemy": {}})
        for t in (1.0, 2.0, 3.0):
            manager.notify("burst_cast", t, "메어리 : 베이 갓데스")

        buffs = manager.get_buffs("메어리 : 베이 갓데스", "__enemy__", 3.0)
        self.assertAlmostEqual(buffs["element_bonus_pct"], 43.09, places=2)
        self.assertNotIn("해변의 햇살", {ab.effect.get("name") for ab in manager._active})

    def test_vesti_burst_and_full_charge_damage_activate_without_partner_states(self):
        members = ["리틀 머메이드", "크라운", "베스티 : 택티컬 업", "test_B3"]
        squad = build_squad(members)
        config = build_config(squad, {"first_burst_time": 1.0, "duration": 8.0})
        result = simulate(squad, config=config, verbose=True, seed=1)

        skill_names = {
            hit.skill_name for hit in result.hits if hit.caster == "베스티 : 택티컬 업"
        }
        buff_names = {
            event.name for event in result.log.buff_events
            if event.kind == "activate" and event.caster == "베스티 : 택티컬 업"
        }
        self.assertIn("몬스터 스테이지", skill_names)
        self.assertIn("미사일 컨테이너 온라인 3", skill_names)
        self.assertNotIn("몬스터 스테이지 2", buff_names)
        self.assertNotIn("몬스터 스테이지 3", buff_names)

    def test_crust_hold_sequence_reaches_blanching_mode(self):
        members = ["리틀 머메이드", "크러스트", "test_B3", "스노우 화이트 : 헤비암즈"]
        control = {"sequence": [
            {"t": 0.0, "action": "hold", "until": 2.2},
            {"t": 2.3, "action": "hold", "until": 4.9},
            {"t": 5.0, "action": "hold", "until": 7.6},
        ]}
        squad = build_squad(members, {"크러스트": {"control": control}})
        config = build_config(squad, {"duration": 9.0})
        result = simulate(squad, config=config, verbose=True, seed=1)

        names = {
            event.name for event in result.log.buff_events
            if event.kind == "activate" and event.caster == "크러스트"
        }
        self.assertIn("블렌칭", names)
        self.assertIn("든든한 요리", names)

    def test_multi_hit_threshold_matches_a_single_attack_with_enough_hits(self):
        squad = build_squad(["프리바티 : 언카인드 메이드"])
        manager = BuffManager(squad, {"enemy": {}})

        manager.notify("multi_hit:10", 1.0, "프리바티 : 언카인드 메이드")

        buffs = manager.get_buffs("프리바티 : 언카인드 메이드", "__enemy__", 1.0)
        self.assertAlmostEqual(buffs["reload_speed_pct"], 20.88)

    def test_shotgun_timeline_emits_multi_hit_for_each_attack(self):
        squad = build_squad(["프리바티 : 언카인드 메이드"])
        config = build_config(squad, {"duration": 2.0})

        result = simulate(squad, config=config, verbose=True, seed=1)

        activations = [
            event for event in result.log.buff_events
            if event.kind == "activate" and event.name == "사랑 가득 메이드"
        ]
        self.assertGreaterEqual(len(activations), 1)

    def test_non_full_charge_counter_activates_crust_mode_and_missing_buff_target(self):
        squad = build_squad(["크러스트", "리타"])
        manager = BuffManager(squad, {"enemy": {}})

        for t in (1.0, 2.0, 3.0):
            manager.notify("non_full_charge_hit", t, "크러스트")

        liter = manager.get_buffs("리타", "__enemy__", 3.0)
        self.assertTrue(manager._has_self_state("크러스트", "마이야르"))
        self.assertGreater(liter["def_caster_based_pct"], 0.0)

    def test_charge_hold_counter_exposes_threshold_and_activates_blanching(self):
        squad = build_squad(["크러스트"])
        manager = BuffManager(squad, {"enemy": {}})
        self.assertEqual(manager.charge_hold_thresholds("크러스트"), [(1.0, "1")])

        for t in (1.0, 2.0, 3.0):
            manager.notify("charge_hold:1", t, "크러스트")

        self.assertTrue(manager._has_self_state("크러스트", "블렌칭"))

    def test_tia_cover_heal_dispatches_cover_healed_event(self):
        members = ["티아", "리틀 머메이드", "크라운", "test_B3", "스노우 화이트 : 헤비암즈"]
        squad = build_squad(members)
        config = build_config(squad, {"first_burst_time": 1.0, "duration": 4.0})

        result = simulate(squad, config=config, verbose=True, seed=1)

        names = {
            event.name for event in result.log.buff_events
            if event.kind == "activate" and event.caster == "티아"
        }
        self.assertIn("파충류 애호가", names)
        self.assertIn("파충류 애호가 2", names)

    def test_neon_bonus_damage_is_limited_to_fire_code_enemy(self):
        members = ["리틀 머메이드", "크라운", "네온 : 블루 오션", "test_B3"]
        counts = []
        for code in ("작열", "수냉"):
            squad = build_squad(members)
            config = build_config(squad, {"first_burst_time": 1.0, "duration": 8.0})
            result = simulate(squad, config=config, enemy={"code": code}, seed=1)
            counts.append(sum(
                1 for hit in result.hits
                if hit.caster == "네온 : 블루 오션" and hit.skill_name == "풀 하이드로 샷 2"
            ))
        self.assertGreater(counts[0], 0)
        self.assertEqual(counts[1], 0)

    def test_signal_burst_damage_and_following_defense_debuff_both_activate(self):
        members = ["리틀 머메이드", "시그널", "test_B3", "스노우 화이트 : 헤비암즈"]
        squad = build_squad(members)
        config = build_config(squad, {"first_burst_time": 1.0, "duration": 5.0})
        result = simulate(squad, config=config, verbose=True, seed=1)

        self.assertTrue(any(
            hit.caster == "시그널" and hit.skill_name == "이머전시 시그널"
            for hit in result.hits
        ))
        self.assertTrue(any(
            event.kind == "activate" and event.name == "이머전시 시그널 2"
            for event in result.log.buff_events
        ))

    def test_poli_favorite_chain_consumes_badge_and_starts_heal(self):
        members = ["리틀 머메이드", "폴리", "크라운", "test_B3", "스노우 화이트 : 헤비암즈"]
        squad = build_squad(members, {"폴리": {"favorite_stage": 3}})
        config = build_config(squad, {"first_burst_time": 1.0, "duration": 22.0})
        result = simulate(squad, config=config, verbose=True, seed=1)

        buff_names = {
            event.name for event in result.log.buff_events
            if event.kind == "activate" and event.caster == "폴리"
        }
        instant_names = {
            event.name for event in result.log.instant_events if event.caster == "폴리"
        }
        self.assertIn("폴리스 뱃지", buff_names)
        self.assertIn("폴리스 라인 폴리스 뱃지 불굴", buff_names)
        self.assertIn("도그 테라피", buff_names)
        self.assertIn("폴리스 뱃지 제거", instant_names)
        self.assertIn("도그 테라피 3", instant_names)


if __name__ == "__main__":
    unittest.main()
