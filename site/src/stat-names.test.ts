import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STAT_NAMES, statName, statText } from './stat-names';

describe('효과 이름', () => {
  it('스킬 데이터에 쓰이는 효과 키를 모두 한글로 갖고 있다', () => {
    // 새 캐릭터가 못 보던 효과를 들고 오면 여기서 잡힌다 — 화면에 영어가 새는 것을 막는다.
    const raw = readFileSync(
      join(import.meta.dirname, '..', '..', 'data', 'parsed_skills.json'), 'utf8',
    );
    const used = new Set(
      [...raw.matchAll(/"stat":\s*"([a-z_]+)"/g)].map((match) => match[1]!),
    );
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((stat) => !(stat in STAT_NAMES)).sort();
    expect(missing).toEqual([]);
  });

  it('모르는 키는 지우지 않고 그대로 남긴다', () => {
    expect(statName('made_up_stat')).toBe('made_up_stat');
    expect(statText('made_up_stat', 3)).toBe('made_up_stat +3');
  });

  it('퍼센트와 초를 가려 붙인다', () => {
    expect(statText('atk_dmg_pct', 20.994)).toBe('주는 대미지 증가 +20.99%');
    expect(statText('crit_rate', 11.85)).toBe('치명타 확률 +11.85%');    // `_pct`가 아니어도 %다
    expect(statText('burst_cooldown_reduce', 5.34)).toBe('버스트 쿨타임 감소 +5.34초');
    expect(statText('buff_stack_add', 1)).toBe('버프 중첩 추가 +1');
  });

  it('값이 없으면 이름만 적는다', () => {
    expect(statText('invincible')).toBe('무적');
    expect(statText('atk_pct', Number.NaN)).toBe('공격력 증가');
  });

  it('내려가는 값은 부호를 그대로 둔다', () => {
    expect(statText('def_pct', -12.5)).toBe('방어력 증가 -12.5%');
  });
});
