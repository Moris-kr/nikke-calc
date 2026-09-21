import { describe, expect, it } from 'vitest';

import { cubeDisplayName, cubeLine, cubeNickname, CUBE_NICKNAMES } from './cube-names';

describe('큐브 부르는 이름', () => {
  it('정식 이름 뒤에 별명을 괄호로 붙인다 — 「렐릭 베어 큐브 (재장)」', () => {
    expect(cubeDisplayName('렐릭 베어 큐브')).toBe('렐릭 베어 큐브 (재장)');
    expect(cubeDisplayName('택티컬 베어 큐브')).toBe('택티컬 베어 큐브 (탄충)');
  });

  it('이름표에 없는 큐브는 효과 스탯으로 찾고, 그것도 없으면 정식 이름만 적는다', () => {
    expect(cubeNickname('새 큐브', 'reload_speed_pct')).toBe('재장');
    expect(cubeDisplayName('새 큐브', 'no_such_stat')).toBe('새 큐브');
    expect(cubeDisplayName('새 큐브')).toBe('새 큐브');
  });

  it('레벨까지 한 줄로 · 안 낀 것은 «없음»', () => {
    expect(cubeLine({ name: '렐릭 부스트 큐브', level: 15 })).toBe('렐릭 부스트 큐브 (차속) Lv15');
    expect(cubeLine({ name: '없음', level: 0 })).toBe('없음');
    expect(cubeLine(undefined)).toBe('없음');
  });

  it('데이터의 큐브 전부가 이름표에 있다 — 어시스터는 «별명 없음»이 답이라 빈 값이다', () => {
    // cube.json의 종류(공통 제외). 새 큐브가 들어오면 여기와 이름표에 함께 더한다.
    const names = [
      '렐릭 어설트 큐브', '택티컬 어설트 큐브', '렐릭 베어 큐브', '택티컬 베어 큐브', '렐릭 부스트 큐브', '택티컬 부스트 큐브',
      '렐릭 퀀텀 큐브', '렐릭 비고르 큐브', '렐릭 인듀어 큐브', '렐릭 힐링 큐브', '렐릭 템퍼링 큐브', '렐릭 어시스터 큐브',
      '렐릭 디스트로이 큐브', '렐릭 피어싱 큐브', '렐릭 크래시 큐브', '렐릭 커버 큐브', '렐릭 디바이드 큐브',
    ];
    for (const name of names) expect(name in CUBE_NICKNAMES, name).toBe(true);
    expect(cubeDisplayName('렐릭 퀀텀 큐브')).toBe('렐릭 퀀텀 큐브 (버충)');
    expect(cubeDisplayName('렐릭 커버 큐브')).toBe('렐릭 커버 큐브 (엄폐물)');
    expect(cubeDisplayName('렐릭 크래시 큐브')).toBe('렐릭 크래시 큐브 (방무)');
    // 어시스터는 max_hp_pct라 스탯 뒷길로 «체력»이 붙을 수 있다 — 이름표의 빈 값이 이긴다.
    expect(cubeDisplayName('렐릭 어시스터 큐브', 'max_hp_pct')).toBe('렐릭 어시스터 큐브');
  });
});
