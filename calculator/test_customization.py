from __future__ import annotations

import json
import unittest
from pathlib import Path

from calculator.buff_manager import BuffManager
from calculator.customization import OVERLOAD_FIELDS, normalize_character_overrides
from calculator.timeline import simulate
from context.spec import build_config, build_squad, is_preview
from context.spec import _nikke as parsed_nikke


class CharacterCustomizationTest(unittest.TestCase):
    def test_weapon_mode_swap_delay_is_normalized_and_validated(self):
        self.assertEqual(
            normalize_character_overrides(
                {"weaponModeSwapAt": 6},
                character_name="신데렐라 : 크리스탈 웨이브",
            ),
            {"weapon_mode_swap": True, "weapon_mode_swap_at": 6.0},
        )
        for bad in (-0.1, 180.1, True, "6"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    normalize_character_overrides({"weaponModeSwapAt": bad})
        with self.assertRaises(ValueError):
            normalize_character_overrides(
                {"weaponModeSwapAt": 6}, character_name="리타"
            )

    def test_legacy_weapon_mode_swap_keeps_zero_second_eligibility(self):
        name = "신데렐라 : 크리스탈 웨이브"

        def first_swap(overrides):
            squad = build_squad([name], {name: overrides})
            result = simulate(
                squad,
                config=build_config(squad, {"duration": 25.0}),
                verbose=True,
                seed=1,
            )
            return next(
                event.t for event in result.log.buff_events
                if event.kind == "activate" and event.caster == name
                and event.name == "디스트로이"
            )

        self.assertEqual(
            first_swap({"weapon_mode_swap": True}),
            first_swap({"weapon_mode_swap": True, "weapon_mode_swap_at": 0.0}),
        )

    def test_weapon_mode_swap_waits_until_requested_battle_time(self):
        name = "신데렐라 : 크리스탈 웨이브"
        squad = build_squad([name], {
            name: {"weapon_mode_swap": True, "weapon_mode_swap_at": 20.0},
        })
        result = simulate(
            squad,
            config=build_config(squad, {"duration": 30.0}),
            verbose=True,
            seed=1,
        )
        swaps = [
            event for event in result.log.buff_events
            if event.kind == "activate" and event.caster == name and event.name == "디스트로이"
        ]
        self.assertTrue(swaps)
        self.assertGreaterEqual(swaps[0].t, 20.0)

    def test_all_nine_overload_options_are_browser_safe(self):
        self.assertEqual(set(OVERLOAD_FIELDS), {
            "atk_pct", "def_pct", "element_bonus", "max_ammo_pct",
            "crit_rate", "crit_dmg", "charge_speed_pct",
            "charge_dmg_pct", "accuracy_pct",
        })
        normalized = normalize_character_overrides({
            "overload": {key: 1 for key in OVERLOAD_FIELDS},
        })
        self.assertEqual(set(normalized["equip_skills"]), set(OVERLOAD_FIELDS))

    def test_supported_controls_are_normalized_and_unknown_policies_rejected(self):
        raw = {
            "control": {
                "tap_fire": {"rate": 3.6, "release": 0.03},
                "reload": {"policy": "before_fb_end", "lead": 0.3},
                "hold": {"policy": "own_full_burst", "lead": 0.5},
                "cover": {"policy": "own_full_burst"},
            },
        }
        self.assertEqual(
            normalize_character_overrides(raw)["_control_override"], raw["control"]
        )
        with self.assertRaises(ValueError):
            normalize_character_overrides({
                "control": {"reload": {"policy": "impossible"}},
            })

    def test_every_raw_extra_advantage_has_structured_target_code(self):
        root = Path(__file__).resolve().parents[1]
        raw = json.loads(
            (root / "scraper" / "nikke_scraped.json").read_text(encoding="utf-8")
        )
        parsed = json.loads(
            (root / "data" / "parsed_skills.json").read_text(encoding="utf-8")
        )
        expected = {}
        for name, character in raw.items():
            sources = list((character.get("스킬") or {}).values())
            sources += list((character.get("애장품") or {}).get("단계별") or [])
            for source in sources:
                template = source.get("template", "")
                for code in ("작열", "수냉", "풍압", "전격", "철갑"):
                    if f"{code} 코드 적에게 우월 코드 대미지 적용" in template:
                        expected[name] = code
        actual = {
            name: effect["target_code"]
            for name, effects in parsed.items()
            for effect in effects
            if effect.get("stat") == "element_code_override"
        }
        self.assertEqual(actual, expected)

    def test_sugar_uses_favorite_item_stage_three_effects(self):
        sugar = build_squad(["슈가"], {
            "슈가": {"equip_skills": {
                "atk_pct": 0,
                "element_bonus": 0,
                "max_ammo_pct": 0,
            }},
        })[0]
        manager = BuffManager([sugar], {"enemy": {"code": "작열"}})
        manager.notify("battle_start", 0, "슈가")
        start = manager.get_buffs("슈가", "__enemy__", 0)
        # 우월 코드 추가 부여는 버프 집계(get_buffs)가 아니라 전용 경로로 판정한다
        # — `BuffManager.element_override_match` → `CharState.element_match`.
        self.assertTrue(manager.element_override_match("슈가", "작열"))
        self.assertFalse(manager.element_override_match("슈가", "수냉"))
        self.assertEqual(start["atk_dmg_pct"], 19.98)

        manager.notify("full_burst_start", 1, "슈가")
        full_burst = manager.get_buffs("슈가", "__enemy__", 1)
        self.assertEqual(full_burst["atk_pct"], 25.01)
        self.assertEqual(full_burst["max_ammo_pct"], 83.8)
        self.assertEqual(full_burst["element_bonus_pct"], 59.11)

        manager.notify("burst_cast", 2, "슈가")
        burst = manager.get_buffs("슈가", "__enemy__", 2)
        self.assertEqual(burst["attack_speed_pct"], 66)
        self.assertAlmostEqual(burst["atk_pct"], 45.01)
        self.assertAlmostEqual(burst["element_bonus_pct"], 119.12)

    def test_extra_element_advantage_is_structured_and_enemy_specific(self):
        rapi = build_squad(["라피 : 레드 후드"])[0]

        electric = BuffManager([rapi], {"enemy": {"code": "전격"}})
        electric.notify("battle_start", 0, "라피 : 레드 후드")
        self.assertTrue(electric.element_override_match("라피 : 레드 후드", "전격"))

        water = BuffManager([rapi], {"enemy": {"code": "수냉"}})
        water.notify("battle_start", 0, "라피 : 레드 후드")
        self.assertFalse(water.element_override_match("라피 : 레드 후드", "수냉"))

    def test_growth_stage_is_normalized_for_the_engine(self):
        self.assertEqual(
            normalize_character_overrides(
                {"growthStage": 6}, character_name="리타"
            ),
            {"breakthrough": 3, "core_enhancement": 3, "affinity": 30},
        )
        self.assertEqual(
            normalize_character_overrides(
                {"growthStage": 3}, character_name="크라운"
            )["affinity"],
            40,
        )

    def test_growth_stage_requires_character_context_and_legal_rarity_range(self):
        invalid = (
            (None, 3),
            ("리타", None),
            ("리타", True),
            ("리타", 1.5),
            ("리타", -1),
            ("리타", 11),
            ("라피", 3),
            ("iDoll 플라워", 1),
        )
        for name, stage in invalid:
            with self.subTest(name=name, stage=stage):
                with self.assertRaises(ValueError):
                    normalize_character_overrides(
                        {"growthStage": stage}, character_name=name
                    )

    def test_skill_levels_are_normalized_for_the_engine(self):
        self.assertEqual(
            normalize_character_overrides({
                "skillLevels": {"1": 1, "2": 5, "3": 10},
            }),
            {"skill_levels": {"1": 1, "2": 5, "3": 10}},
        )

    def test_skill_levels_reject_unknown_keys_and_invalid_values(self):
        invalid = (
            {"4": 10},
            {"1": True},
            {"1": 1.5},
            {"1": 0},
            {"1": 11},
        )
        for skill_levels in invalid:
            with self.subTest(skill_levels=skill_levels):
                with self.assertRaises(ValueError):
                    normalize_character_overrides({"skillLevels": skill_levels})

    def test_released_skill_level_selects_the_parsed_effect_value(self):
        values = []
        for level in (1, 10):
            squad = build_squad(["리타"], {
                "리타": {"skill_levels": {"1": level, "2": 10, "3": 10}},
            })
            manager = BuffManager(squad, {"enemy": {}})
            manager.notify("burst_cast", 0, "리타")
            values.append(manager.get_buffs("리타", "__enemy__", 0)["max_ammo_pct"])

        self.assertEqual(values, [7.05, 45.17])

    def test_preview_skill_levels_are_fixed_at_ten(self):
        # 프리뷰(출시 전 카드) 캐릭터는 레벨 10 계수만 존재한다. 명단은 출시될 때마다
        # 비므로 이름을 박지 않고 현재 등록된 프리뷰에서 고른다 — 비어 있으면 검사할
        # 대상 자체가 없는 정상 상태다.
        previews = [name for name in parsed_nikke() if is_preview(name)]
        if not previews:
            self.skipTest("등록된 프리뷰 캐릭터가 없다 (전원 정식 출시)")
        preview = previews[0]

        allowed = build_squad([preview], {
            preview: {"skill_levels": {"1": 10, "2": 10, "3": 10}},
        })[0]
        self.assertEqual(allowed["skill_levels"], {"1": 10, "2": 10, "3": 10})

        with self.assertRaisesRegex(ValueError, "프리뷰 캐릭터는 스킬 레벨 10"):
            build_squad([preview], {
                preview: {"skill_levels": {"1": 9, "2": 10, "3": 10}},
            })

    def test_overload_values_replace_resolved_defaults(self):
        over = normalize_character_overrides({
            "overload": {
                "element_bonus": 10,
                "atk_pct": 3,
                "max_ammo_pct": 4,
                "crit_rate": 5,
                "crit_dmg": 6,
            }
        })

        char = build_squad(["미하라 : 본딩 체인"], {
            "미하라 : 본딩 체인": over,
        })[0]

        self.assertEqual(char["equip_skills"]["element_bonus"], 10)
        self.assertEqual(char["equip_skills"]["atk_pct"], 3)
        self.assertEqual(char["equip_skills"]["max_ammo_pct"], 4)
        self.assertEqual(char["equip_skills"]["crit_rate"], 5)
        self.assertEqual(char["equip_skills"]["crit_dmg"], 6)

    def test_stacked_max_ammo_reductions_never_drop_magazine_below_one(self):
        # 프리바티 `EX 매거진 3`은 풀버스트마다 전원 최대 장탄 -50.66%를,
        # 아니스 : 스파클링 서머 `스파클링 웨이브`는 자기 버스트 사이클에 자신
        # 최대 장탄 -73.92%를 건다. 둘이 겹치는 아니스의 버스트 사이클에는 합이
        # -124.58%가 되어 실효 최대 장탄이 `round(5 × -0.2458) = -1`로 음수가 됐고,
        # 재장전이 채우는 장탄이 음수라 `_tick_auto`가 발사 없이 재장전만 반복해
        # 아니스가 자기 버스트 내내 한 발도 못 쐈다. 게임에선 최대 장탄이 최소 1발로
        # 유지되므로, 어떤 캐릭터의 실효 장탄도 음수가 되면 안 된다.
        members = ["아니스 : 스파클링 서머", "프리바티", "네온 : 비전 아이", "목단", "민트"]
        squad = build_squad(members)
        config = build_config(squad, {"first_burst_time": 3.0})
        result = simulate(squad, config=config, verbose=True, seed=1)

        min_ammo = min(entry.ammo for entry in result.log.ammo_log)
        self.assertGreaterEqual(min_ammo, 0, "실효 최대 장탄이 음수로 내려갔다 (스톨)")

    def test_split_cube_is_accepted_and_applies_split_damage(self):
        self.assertEqual(
            normalize_character_overrides({"cube": {"name": "렐릭 디바이드 큐브", "level": 15}}),
            {"cube": {"name": "렐릭 디바이드 큐브", "level": 15}},
        )
        squad = build_squad(["브래디"], {"브래디": {"cube": {"name": "렐릭 디바이드 큐브", "level": 15}}})
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "브래디")
        buffs = manager.get_buffs("브래디", "__enemy__", 0)
        self.assertAlmostEqual(buffs["split_dmg_pct"], 17.69, places=2)

    def test_equip_levels_map_to_per_part_equipment(self):
        self.assertEqual(
            normalize_character_overrides({
                "equipLevels": {"머리": 5, "몸통": 3, "팔": 0, "다리": 5},
            }),
            {"equipment": {
                "머리": {"level": 5}, "몸통": {"level": 3},
                "팔": {"level": 0}, "다리": {"level": 5},
            }},
        )
        for bad in ({"머리": 6}, {"머리": -1}, {"머리": 1.5}, {"머리": True}, {"등": 5}):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    normalize_character_overrides({"equipLevels": bad})

    def test_burst_assignment_is_normalized_and_validated(self):
        self.assertEqual(
            normalize_character_overrides({"burst": {"mode": "priority", "every": 3}}),
            {"_burst_assignment": {"mode": "priority", "every": 3}},
        )
        # every 기본값은 1
        self.assertEqual(
            normalize_character_overrides({"burst": {"mode": "priority"}}),
            {"_burst_assignment": {"mode": "priority", "every": 1}},
        )
        self.assertEqual(
            normalize_character_overrides({"burst": {"mode": "skip"}}),
            {"_burst_assignment": {"mode": "skip"}},
        )
        for bad in (
            {"mode": "always"},
            {"mode": "priority", "every": 0},
            {"mode": "priority", "every": 1.5},
            {"mode": "priority", "every": True},
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    normalize_character_overrides({"burst": bad})

    def test_manual_damage_stat_applies_only_to_its_character(self):
        squad = build_squad(["리타", "라피"], {
            "리타": {"manual_stats": {"split_dmg_pct": 20}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "리타")
        manager.notify("battle_start", 0, "라피")

        self.assertEqual(manager.get_buffs("리타", "__enemy__", 0)["split_dmg_pct"], 20)
        self.assertEqual(manager.get_buffs("라피", "__enemy__", 0)["split_dmg_pct"], 0)

    def test_personal_enemy_modifiers_do_not_leak_to_teammates(self):
        squad = build_squad(["리타", "라피"], {
            "리타": {"manual_stats": {
                "received_dmg_pct": 12,
                "enemy_def_down_pct": 7,
            }},
        })
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "리타")
        manager.notify("battle_start", 0, "라피")

        rita = manager.get_buffs("리타", "__enemy__", 0)
        rapi = manager.get_buffs("라피", "__enemy__", 0)
        self.assertEqual(rita["received_dmg"], 12)
        self.assertEqual(rita["enemy_def_down_pct"], -7)
        self.assertEqual(rapi["received_dmg"], 0)
        self.assertEqual(rapi["enemy_def_down_pct"], 0)

    def test_part_cube_routes_its_value_to_part_damage(self):
        squad = build_squad(["리타"], {
            "리타": {"cube": {"name": "렐릭 디스트로이 큐브", "level": 15}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "리타")

        self.assertEqual(
            manager.get_buffs("리타", "__enemy__", 0)["part_dmg_pct"],
            31.9,
        )

    def test_ammo_cube_triggers_every_tenth_hit_not_at_battle_start(self):
        squad = build_squad(["리타"], {
            "리타": {"cube": {"name": "택티컬 베어 큐브", "level": 15}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        events: list[tuple[str, float]] = []
        manager.register_instant_handler(
            "ammo_charge_flat",
            lambda _eff, caster, _t, value: events.append((caster, value)),
        )

        manager.notify("battle_start", 0, "리타")
        self.assertEqual(events, [])
        for hit in range(1, 10):
            manager.notify("hit_count", hit / 10, "리타")
        self.assertEqual(events, [])
        manager.notify("hit_count", 1, "리타")
        self.assertEqual(events, [("리타", 3.0)])

    def test_manual_ammo_recovery_uses_the_same_tenth_hit_semantics(self):
        squad = build_squad(["리타"], {
            "리타": {"manual_stats": {"ammo_charge_flat": 8}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        events: list[float] = []
        manager.register_instant_handler(
            "ammo_charge_flat",
            lambda _eff, _caster, _t, value: events.append(value),
        )

        manager.notify("battle_start", 0, "리타")
        for hit in range(10):
            manager.notify("hit_count", hit / 10, "리타")
        self.assertEqual(events, [8.0])


    def test_nayuta_burst_mode_shots_do_not_eat_bullet_buffs(self):
        """나유타 `기억 연소` 사격은 스킬 대미지라 발수 소모 버프를 먹지 않는다.

        미란다 `웨이크업! 4`는 `duration_bullets: 1`이라 한 발만 쏘면 사라진다.
        변신 사격이 일반 공격으로 잡히던 때는 변신 첫 발이 이걸 먹어 버렸다
        (유저 인게임 확인 — GAMEPLAY.md §무기 메카닉).
        """
        deck = ["아니스 : 스타", "나유타", "미란다", "홍련 : 흑영", "리버렐리오"]
        # 미란다 버프는 자신 제외 공격력 1위에게 간다 — 나유타가 받도록 올린다.
        squad = build_squad(deck, {"나유타": {"equip_skills": {"atk_pct": 300.0}}})
        result = simulate(
            squad, config=build_config(squad, {"duration": 60, "first_burst_time": 3.0}),
            enemy={"def": 31_784, "code": "", "core_px": 52, "has_parts": False},
            seed=42, verbose=True,
        )
        events = [e for e in result.log.buff_events if e.name.startswith("웨이크업! 4")]
        grants = [e for e in events if e.kind == "activate" and e.target == "나유타"]
        expiries = [e for e in events if e.kind == "expire"]
        self.assertTrue(grants, "나유타가 `웨이크업! 4`를 받아야 한다")

        first = grants[0]
        after = [e for e in expiries if e.t >= first.t]
        self.assertTrue(after, "만료 이벤트가 있어야 한다")
        # 변신은 10초다. 첫 발에 먹혔다면 1초 안에 사라진다.
        self.assertGreater(
            after[0].t - first.t, 5.0,
            "변신 사격이 발수 버프를 먹었다 — 스킬 대미지 예외가 풀렸다",
        )

        # 변신 사격은 `기본 공격`이 아니라 모드 이름으로 잡힌다.
        modes = {h.skill_name for h in result.hits if h.caster == "나유타"}
        self.assertIn("기억 연소", modes)

        # 발사 태그(`full_charge_hit`)를 그대로 달고 있어도 평타로 새면 안 된다 —
        # 집계는 이름을 우선해야 한다.
        from calculator.sim_result import _is_normal
        mode_hits = [h for h in result.hits
                     if h.caster == "나유타" and h.skill_name == "기억 연소"]
        self.assertTrue(mode_hits)
        self.assertFalse(any(_is_normal(h) for h in mode_hits))

    def test_other_weapon_change_modes_stay_normal_attacks(self):
        """예외는 나유타뿐이다 — 표시 없는 모드는 종전대로 일반 공격으로 잡힌다."""
        squad = build_squad(["라플라스"])
        result = simulate(
            squad, config=build_config(squad, {"duration": 60, "first_burst_time": 3.0}),
            enemy={"def": 31_784, "code": "", "core_px": 52, "has_parts": False},
            seed=42,
        )
        modes = {h.skill_name for h in result.hits if h.caster == "라플라스"}
        self.assertIn("기본 공격", modes)
        self.assertNotIn("라플라스 버스터", modes)


if __name__ == "__main__":
    unittest.main()
