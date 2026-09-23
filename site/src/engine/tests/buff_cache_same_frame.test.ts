/**
 * 같은 프레임 안에서 이미 활성인 버프의 중첩이 오르면, 뒤이은 조회가 그 값을 본다.
 * 파이썬: calculator/test_buff_cache_same_frame.py
 *
 * `get_buffs`는 (시전자, t, 캐시 버전)으로 결과를 캐시한다. 새 버프가 붙거나 빠지면 버전이
 * 오르지만, **이미 붙은 버프의 재발동(중첩 +1·지속 갱신)**은 버전을 안 올렸다. 그래서 같은
 * 프레임에 먼저 조회한 쪽이 있으면 뒤의 조회가 갱신 전 중첩을 그대로 받았다 — 누가 먼저
 * 조회했느냐에 따라 딜이 달라졌다(실측 2026-09-23, 아스카 : WILLE `안티 AT 필드` 18→19).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData } from './helpers';
import { BuffManager } from '../buff_manager';
import { _quant_sum } from '../timeline';
import { build_squad } from '../spec';

beforeAll(loadEngineData);

describe('SameFrameStackRefreshTest', () => {
  it('test_stack_refresh_in_same_frame_is_visible', () => {
    const name = '마스트 : 로망틱 메이드';
    const squad = build_squad([name]);
    const bm = new BuffManager(squad, { enemy: {} });
    bm.battle_start();
    bm.state['rng_acc'] = {};
    const t = 5.0;
    bm.notify('burst_enter:1', t, name);
    const first = bm.get_buffs(name, '__enemy__', t)['accuracy_pct'];
    // 같은 프레임에 한 번 더 — 중첩이 오른다.
    bm.notify('burst_enter:1', t, name);
    const second = bm.get_buffs(name, '__enemy__', t)['accuracy_pct'];
    expect(second).toBeLessThan(first);
    // 캐시 없이 새로 센 값과 같아야 한다.
    bm._buffs_cache.clear();
    expect(bm.get_buffs(name, '__enemy__', t)['accuracy_pct']).toBe(second);
  });

  it('test_max_ammo_fast_path_matches_full_lookup', () => {
    // 장탄 전용 조회는 전체 조회의 두 키와 같은 값을 낸다.
    for (const name of ['라피 : 레드 후드', '앨리스', '홍련', '모더니아']) {
      const squad = build_squad([name]);
      const bm = new BuffManager(squad, { enemy: {} });
      bm.battle_start();
      for (const t of [0.0, 3.0, 10.0]) {
        const fast = bm.max_ammo_buffs(name, '__enemy__', t);
        bm._buffs_cache.clear();
        const full = bm.get_buffs(name, '__enemy__', t);
        const base = 100;
        expect(_quant_sum(base, fast, 'max_ammo_pct', 1.0), name)
          .toBe(_quant_sum(base, full, 'max_ammo_pct', 1.0));
        expect(fast['max_ammo_flat'], name).toBe(full['max_ammo_flat']);
      }
    }
  });
});
