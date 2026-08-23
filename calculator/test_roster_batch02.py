import json
import unittest
from pathlib import Path

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


ROOT = Path(__file__).resolve().parents[1]
BATCH = [
    "키리", "D", "K", "미카 : 스노우 버디", "브리드",
    "솔린", "디젤", "엠마", "베스티", "은화",
]


def _skills():
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


def _find(name, *, stat=None, effect_name=None, favorite=None):
    effects = _skills()[name]
    return [
        effect for effect in effects
        if (stat is None or effect.get("stat") == stat)
        and (effect_name is None or effect.get("name") == effect_name)
        and (favorite is None or effect.get("favorite") == favorite)
    ]


def test_batch02_all_ten_are_registered():
    skills = _skills()
    assert all(name in skills for name in BATCH)
    assert len([name for name in skills if not name.startswith("test_")]) >= 106


def test_kiri_full_charge_and_defender_support_are_preserved():
    assert _find("키리", stat="atk_caster_based_pct", effect_name="곁눈질")
    assert _find("키리", stat="max_hp_pct", effect_name="훑어보기")[0]["target"] == "allies_class:방어"
    assert _find("키리", stat="heal_hp_pct", effect_name="꿰뚫어보기")[0]["tick_interval"] == 1.0


def test_d_target_spawn_and_fullburst_extension_are_preserved():
    gauge = _find("D", stat="burst_" + "charge_pct", effect_name="기습")[0]
    assert gauge["trigger"]["timing"] == ["event:target_spawn"]
    extension = _find("D", stat="fullburst_duration", effect_name="처단 3")[0]
    assert extension["fixed_value"] == 5.04
    assert "self_state:기절 면역" in extension["trigger"]["condition"]


def test_target_spawn_is_emitted_once_at_battle_start():
    manager = BuffManager(build_squad(["D"]), {"enemy": {}})
    manager.battle_start()

    assert manager._has_self_state("D", "기절 면역")
    assert manager._event_counts["D"]["event:target_spawn"] == 1


def test_k_weapon_change_and_scale_cleanup_are_preserved():
    weapon = [e for e in _skills()["K"] if e.get("type") == "weapon_change"][0]
    assert weapon["pellets"] == 10
    assert weapon["damage_coeff"]["10"] == 92.5
    assert _find("K", stat="remove_named_buff", effect_name="기울어지는 천칭 제거")


def test_mica_stack_extension_and_dispel_are_preserved():
    assert _find("미카 : 스노우 버디", stat="buff_" + "max_stack_add", effect_name="응원의 축포")
    assert _find("미카 : 스노우 버디", stat="debuff_cleanse", effect_name="설온제")


def test_brid_hidden_cooldown_and_full_hp_bonus_are_preserved():
    leak = _find("브리드", stat="damage", effect_name="리크")[0]
    assert leak["trigger"]["timing"] == ["every:10s"]
    assert "self_hp_max" in _find("브리드", stat="bonus_damage", effect_name="AZX 2")[0]["trigger"]["condition"]


def test_soline_full_hp_passive_and_burst_bonus_are_preserved():
    assert _find("솔린", stat="crit_rate", effect_name="어른스럽게!")[0]["duration"] == -1
    assert "self_hp_max" in _find("솔린", stat="bonus_damage", effect_name="나도 한다면 해! 2")[0]["trigger"]["condition"]


def test_diesel_all_favorite_replacements_are_preserved():
    assert _find("디젤", stat="pierce_dmg_pct", effect_name="딸기 사탕의 힘 3", favorite=1)
    assert _find("디젤", stat="max_hp_only_pct", effect_name="스트로베리 쇼크 2", favorite=2)
    assert _find("디젤", stat="buff_" + "max_stack_add", effect_name="딸기향 이끌림 3", favorite=3)


def test_emma_received_hit_probability_and_heals_are_preserved():
    cheer = _find("엠마", stat="heal_hp_pct", effect_name="치어리딩")[0]
    assert cheer["trigger"]["timing"] == ["received_hit_count:1"]
    assert cheer["trigger"]["condition"] == ["prob:5"]
    assert _find("엠마", stat="lifesteal_pct", effect_name="알트루이즘 2")


def test_vesti_three_burst_layers_and_container_are_preserved():
    effects = _skills()["베스티"]
    assert {e["trigger"]["timing"][0] for e in effects if e["name"].startswith("생존본능")} >= {
        "burst_cast_count:1", "burst_cast_count:2", "burst_cast_count:3"
    }
    container = _find("베스티", stat="auto_damage", effect_name="미사일 컨테이너")[0]
    assert container["tick_interval"] == 1.0 and container["duration"] == 18.0


def test_eunhwa_last_bullet_round_limited_buffs_are_preserved():
    stance = _find("은화", stat="charge_dmg_pct", effect_name="준비 태세")[0]
    assert stance["trigger"]["timing"] == ["last_bullet_fire"]
    assert stance["duration_bullets"] == 2
    assert _find("은화", stat="def_pct", effect_name="약점 간파")[0]["polarity"] == "harmful"


def _check_character_runs_in_a_valid_squad(name, members):
    squad = build_squad(members)
    result = simulate(squad, config=build_config(squad, {"first_burst_time": 1.0, "duration": 8.0}), seed=1)

    assert any(hit.caster == name for hit in result.hits)


class RosterBatch02Test(unittest.TestCase):
    def test_all_data_contracts(self):
        checks = [
            test_batch02_all_ten_are_registered,
            test_kiri_full_charge_and_defender_support_are_preserved,
            test_d_target_spawn_and_fullburst_extension_are_preserved,
            test_target_spawn_is_emitted_once_at_battle_start,
            test_k_weapon_change_and_scale_cleanup_are_preserved,
            test_mica_stack_extension_and_dispel_are_preserved,
            test_brid_hidden_cooldown_and_full_hp_bonus_are_preserved,
            test_soline_full_hp_passive_and_burst_bonus_are_preserved,
            test_diesel_all_favorite_replacements_are_preserved,
            test_emma_received_hit_probability_and_heals_are_preserved,
            test_vesti_three_burst_layers_and_container_are_preserved,
            test_eunhwa_last_bullet_round_limited_buffs_are_preserved,
        ]
        for check in checks:
            with self.subTest(check=check.__name__):
                check()

    def test_all_ten_run_in_valid_squads(self):
        cases = [
            ("키리", ["리틀 머메이드", "크라운", "키리", "test_B3"]),
            ("D", ["리틀 머메이드", "크라운", "D", "test_B3"]),
            ("K", ["리틀 머메이드", "크라운", "K", "test_B3"]),
            ("미카 : 스노우 버디", ["미카 : 스노우 버디", "크라운", "test_B3"]),
            ("브리드", ["리틀 머메이드", "크라운", "브리드", "test_B3"]),
            ("솔린", ["리틀 머메이드", "크라운", "솔린", "test_B3"]),
            ("디젤", ["리틀 머메이드", "디젤", "test_B3"]),
            ("엠마", ["엠마", "크라운", "test_B3"]),
            ("베스티", ["리틀 머메이드", "크라운", "베스티", "test_B3"]),
            ("은화", ["리틀 머메이드", "은화", "test_B3"]),
        ]
        for name, members in cases:
            with self.subTest(name=name):
                _check_character_runs_in_a_valid_squad(name, members)

    def test_k_last_bullet_adds_thirty_scales_then_fullburst_clears_them(self):
        manager = BuffManager(build_squad(["K"]), {"enemy": {}})
        manager.notify("last_bullet_fire", 1.0, "K")

        scale = next(ab for ab in manager._active if ab.effect.get("name") == "기울어지는 천칭")
        self.assertEqual(scale.stack, 30)
        self.assertGreater(manager.get_buffs("K", "__enemy__", 1.0)["atk_dmg_pct"], 0.0)

        manager.notify("full_burst_end", 2.0, "K")
        self.assertFalse(manager._has_self_state("K", "기울어지는 천칭"))
        self.assertEqual(manager.get_buffs("K", "__enemy__", 2.0)["atk_dmg_pct"], 0.0)

    def test_brid_hidden_ten_second_skill_and_vesti_container_deal_damage(self):
        brid_squad = build_squad(["리틀 머메이드", "크라운", "브리드", "test_B3"])
        brid_result = simulate(brid_squad, config=build_config(brid_squad, {"duration": 12.0}), seed=1)
        self.assertTrue(any(hit.caster == "브리드" and hit.skill_name == "리크" for hit in brid_result.hits))

        vesti_squad = build_squad(["리틀 머메이드", "크라운", "베스티", "test_B3"])
        vesti_result = simulate(
            vesti_squad,
            config=build_config(vesti_squad, {"first_burst_time": 1.0, "duration": 8.0}),
            seed=1,
        )
        self.assertTrue(any(
            hit.caster == "베스티" and hit.skill_name == "미사일 컨테이너"
            for hit in vesti_result.hits
        ))

    def test_diesel_favorite_attention_opens_the_stack_extension(self):
        squad = build_squad(["디젤"], {"디젤": {"favorite_stage": 3}})
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("burst_cast", 1.0, "디젤")
        for index in range(150):
            manager.notify("hit_count", 2.0 + index / 1000, "디젤")

        self.assertTrue(manager._has_self_state("디젤", "주목"))
        self.assertTrue(manager._has_self_state("디젤", "딸기향 이끌림 3"))

    def test_mica_increases_a_stackable_allied_buffs_runtime_cap(self):
        manager = BuffManager(build_squad(["미카 : 스노우 버디", "K"]), {"enemy": {}})
        for index in range(150):
            manager.notify("hit_count", index / 1000, "미카 : 스노우 버디")
        for index in range(4):
            manager.notify("last_bullet_fire", 1.0 + index, "K")

        scale = next(ab for ab in manager._active if ab.effect.get("name") == "기울어지는 천칭")
        self.assertEqual(scale.stack, 101)


if __name__ == "__main__":
    unittest.main()
