import json
import unittest
from pathlib import Path

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad

ROOT = Path(__file__).resolve().parents[1]
BATCH = ["율하", "애드미", "길로틴", "메이든", "길로틴 : 윈터 슬레이어",
         "루드밀라", "네베", "앨리스 : 원더랜드 바니", "루피", "얀"]

def _skills(): return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))
def _find(name, stat=None, effect_name=None):
    return [e for e in _skills()[name] if (stat is None or e.get("stat")==stat) and (effect_name is None or e.get("name")==effect_name)]

class RosterBatch05Test(unittest.TestCase):
    def test_all_ten_registered(self):
        skills=_skills(); self.assertTrue(all(n in skills for n in BATCH))
        self.assertGreaterEqual(len([n for n in skills if not n.startswith("test_")]),136)

    def test_hidden_cooldowns(self):
        expected={("율하","위크 메이커"):"every:30s",("애드미","고양이 숨결"):"every:20s",
                  ("메이든","언령 : 필중의 언"):"every:30s",("네베","북극곰의 힘"):"every:10s"}
        for (n,e),t in expected.items(): self.assertEqual([t],_find(n,effect_name=e)[0]["trigger"]["timing"])

    def test_winter_guillotine_levels_from_xp_and_spends_reward(self):
        manager=BuffManager(build_squad(["길로틴 : 윈터 슬레이어"]),{"enemy":{}});manager.battle_start()
        for i in range(60): manager.notify_team_hit("squad_body_hit",i/100,"길로틴 : 윈터 슬레이어")
        level=next(ab for ab in manager._active if ab.effect.get("name")=="용사 레벨")
        self.assertEqual(2,level.stack)
        self.assertTrue(manager._has_self_state("길로틴 : 윈터 슬레이어","용사의 자질 3"))

    def test_guillotine_low_hp_and_maiden_revenge_contracts(self):
        self.assertEqual("lost_hp_pct",_find("길로틴",stat="atk_pct",effect_name="흑화 2")[0]["scaling"])
        self.assertEqual(["received_hit_count:20"],_find("메이든",effect_name="언령 : 기교의 언")[0]["trigger"]["timing"])

    def test_bunny_alice_reentry_and_party_stack_are_preserved(self):
        self.assertTrue(_find("앨리스 : 원더랜드 바니",stat="burst_reentry"))
        party=_find("앨리스 : 원더랜드 바니",effect_name="당근 파티")[0]
        self.assertEqual(5,party["max_stack"])
        self.assertEqual(["hit_count:60"],party["trigger"]["timing"])

    def test_all_ten_simulate(self):
        cases=[("율하",["리틀 머메이드","크라운","율하"]),("애드미",["리틀 머메이드","애드미","test_B3"]),
          ("길로틴",["리틀 머메이드","크라운","길로틴"]),("메이든",["리틀 머메이드","크라운","메이든"]),
          ("길로틴 : 윈터 슬레이어",["리틀 머메이드","크라운","길로틴 : 윈터 슬레이어"]),
          ("루드밀라",["루드밀라","크라운","test_B3"]),("네베",["리틀 머메이드","크라운","네베"]),
          ("앨리스 : 원더랜드 바니",["앨리스 : 원더랜드 바니","크라운","test_B3"]),
          ("루피",["리틀 머메이드","루피","test_B3"]),("얀",["얀","크라운","test_B3"])]
        for n,m in cases:
            with self.subTest(name=n):
                squad=build_squad(m);res=simulate(squad,config=build_config(squad,{"first_burst_time":1,"duration":8}),seed=1)
                self.assertTrue(any(h.caster==n for h in res.hits))

if __name__=="__main__": unittest.main()
