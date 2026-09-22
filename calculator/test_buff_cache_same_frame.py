"""같은 프레임 안에서 이미 활성인 버프의 중첩이 오르면, 뒤이은 조회가 그 값을 본다.

`get_buffs`는 (시전자, t, 캐시 버전)으로 결과를 캐시한다. 새 버프가 붙거나 빠지면 버전이
오르지만, **이미 붙은 버프의 재발동(중첩 +1·지속 갱신)**은 버전을 안 올렸다. 그래서 같은
프레임에 먼저 조회한 쪽이 있으면 뒤의 조회가 갱신 전 중첩을 그대로 받았다 — 누가 먼저
조회했느냐에 따라 딜이 달라졌다(실측 2026-09-23, 아스카 : WILLE `안티 AT 필드` 18→19).
"""
import unittest
from collections import defaultdict

from calculator.buff_manager import BuffManager
from context.spec import build_squad


class SameFrameStackRefreshTest(unittest.TestCase):
    def test_stack_refresh_in_same_frame_is_visible(self):
        name = '마스트 : 로망틱 메이드'
        squad = build_squad([name])
        bm = BuffManager(squad, {'enemy': {}})
        bm.battle_start()
        bm.state['rng_acc'] = defaultdict(float)
        t = 5.0
        bm.notify('burst_enter:1', t, name)
        first = bm.get_buffs(name, '__enemy__', t)['accuracy_pct']
        # 같은 프레임에 한 번 더 — 중첩이 오른다.
        bm.notify('burst_enter:1', t, name)
        second = bm.get_buffs(name, '__enemy__', t)['accuracy_pct']
        self.assertLess(second, first)
        # 캐시 없이 새로 센 값과 같아야 한다.
        bm._buffs_cache.clear()
        self.assertEqual(bm.get_buffs(name, '__enemy__', t)['accuracy_pct'], second)

    def test_max_ammo_fast_path_matches_full_lookup(self):
        """장탄 전용 조회는 전체 조회의 두 키와 같은 값을 낸다."""
        from calculator.timeline import _quant_sum
        for name in ('라피 : 레드 후드', '앨리스', '홍련', '모더니아'):
            squad = build_squad([name])
            bm = BuffManager(squad, {'enemy': {}})
            bm.battle_start()
            for t in (0.0, 3.0, 10.0):
                fast = bm.max_ammo_buffs(name, '__enemy__', t)
                bm._buffs_cache.clear()
                full = bm.get_buffs(name, '__enemy__', t)
                base = 100
                self.assertEqual(_quant_sum(base, fast, 'max_ammo_pct', 1.0),
                                 _quant_sum(base, full, 'max_ammo_pct', 1.0), name)
                self.assertEqual(fast['max_ammo_flat'], full['max_ammo_flat'], name)


if __name__ == '__main__':
    unittest.main()
