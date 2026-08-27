import { describe, expect, it } from 'vitest';
import {
  areaToOverrides,
  consoleFrom,
  looksLikeProfileUrl,
  pickArea,
  type RawArea,
} from './blablalink';
import type { CharacterMeta, SettingsCatalog } from './types';

const catalog: CharacterMeta[] = [
  {
    name: '라피', burstStage: '1', elementCode: '작열', weaponType: 'AR',
    className: '화력형', manufacturer: '엘리시온', preview: false, image: null, nameCode: 5001, resourceId: null, aliases: [],
  },
  {
    name: '앨리스', burstStage: '3', elementCode: '수냉', weaponType: 'SR',
    className: '화력형', manufacturer: '필그림', preview: false, image: null, nameCode: 5002, resourceId: null, aliases: [],
  },
  {
    name: '미공개', burstStage: '3', elementCode: '전격', weaponType: 'AR',
    className: '화력형', manufacturer: '테트라', preview: true, image: null, nameCode: 5003, resourceId: null, aliases: [],
  },
];

const settings = {
  characters: {
    라피: { maxGrowthStage: 11, skillLevelsLocked: false },
    앨리스: { maxGrowthStage: 11, skillLevelsLocked: false },
    미공개: { maxGrowthStage: 11, skillLevelsLocked: true },
  },
  cubes: {
    '렐릭 어설트 큐브': { id: 1000301 },
    '렐릭 디바이드 큐브': { id: 1000317 },
  },
  overloadFields: {
    element_bonus: {}, atk_pct: {}, max_ammo_pct: {}, charge_speed_pct: {},
    charge_dmg_pct: {}, accuracy_pct: {}, crit_rate: {}, crit_dmg: {}, def_pct: {},
  },
  favoriteItems: { '100602': 'SR', '200101': 'SSR' },
} as unknown as SettingsCatalog;

/** 부위 4개 × 옵션 3개 슬롯을 0으로 채운 상세. 필요한 것만 덮어 쓴다. */
function detailOf(over: Record<string, number>): Record<string, number> {
  const base: Record<string, number> = {};
  for (const prefix of ['head', 'torso', 'arm', 'leg']) {
    base[`${prefix}_equip_tier`] = 0;
    base[`${prefix}_equip_lv`] = 0;
    for (const slot of [1, 2, 3]) base[`${prefix}_equip_option${slot}_id`] = 0;
  }
  return { ...base, ...over };
}

const area = (over: Partial<RawArea>): RawArea => ({
  area: 83, characters: [], details: [], stateEffects: [], outpost: null, ...over,
});

describe('looksLikeProfileUrl', () => {
  it('블라블라링크 주소와 openid만 받는다', () => {
    expect(looksLikeProfileUrl('https://www.blablalink.com/user?openid=abc')).toBe(true);
    expect(looksLikeProfileUrl('29080-15361668407129878426')).toBe(true);
    expect(looksLikeProfileUrl('15361668407129878426')).toBe(true);
    expect(looksLikeProfileUrl('https://example.com/user?openid=abc')).toBe(false);
    expect(looksLikeProfileUrl('  ')).toBe(false);
  });
});

describe('areaToOverrides', () => {
  it('돌파와 코강을 합쳐 육성 단계로 옮긴다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 3, core: 4 }],
      details: [detailOf({ name_code: 5001, skill1_lv: 10, skill2_lv: 9, ulti_skill_lv: 8 })],
    }), settings, catalog);

    expect(result.matched).toEqual(['라피']);
    expect(result.overrides['라피']!.growthStage).toBe(7);
    expect(result.overrides['라피']!.skillLevels).toEqual({ '1': 10, '2': 9, '3': 8 });
  });

  it('육성 단계는 캐릭터 상한을 넘지 않는다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 9, core: 9 }],
      details: [detailOf({ name_code: 5001 })],
    }), settings, catalog);
    expect(result.overrides['라피']!.growthStage).toBe(11);
  });

  it('오버로드를 12슬롯에서 합산한다 — state_effects가 중복 제거돼 와도', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 0, core: 0 }],
      details: [detailOf({
        name_code: 5001,
        head_equip_option1_id: 7000514, head_equip_option2_id: 7001209,
        torso_equip_option1_id: 7000514,   // 같은 옵션이 두 부위에 — 두 번 더해야 한다
      })],
      // 응답은 옵션 id로 중복 제거돼 온다: 같은 옵션이 2부위여도 한 번만 등장한다.
      // 상류는 옵션 id를 **문자열**로 준다. 장비 슬롯 쪽은 숫자다.
      stateEffects: [
        { id: '7000514', function_details: [{ function_type: 'StatAtk', function_value: 1802 }] },
        { id: 7001209, function_details: [{ function_type: 'StatChargeTime', function_value: -1015 }] },
      ],
    }), settings, catalog);

    const overload = result.overrides['라피']!.overload!;
    expect(overload.atk_pct).toBeCloseTo(36.04, 4);       // 18.02 × 2부위
    expect(overload.charge_speed_pct).toBeCloseTo(10.15, 4); // 음수로 오지만 양수 퍼센트로
    expect(overload.crit_rate).toBe(0);
  });

  it('기업은 강화 레벨로, 일반 티어와 빈 슬롯은 등급 그대로 읽는다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 0, core: 0 }],
      details: [detailOf({
        name_code: 5001,
        head_equip_tier: 10, head_equip_lv: 5,
        torso_equip_tier: 9, torso_equip_lv: 3,   // 일반 T9 — 강화 개념이 없다
        arm_equip_tier: 0, arm_equip_lv: 0,       // 미장착
        leg_equip_tier: 10, leg_equip_lv: 2,
      })],
    }), settings, catalog);

    // 예전에는 기업이 아니면 전부 0(=기업 강화0)으로 뭉갰다. 강화0에도 플랫 스탯이
    // 붙어서 미장착·일반 장비가 공격력을 그냥 얻었다 — 등급을 그대로 넘겨야 한다.
    expect(result.overrides['라피']!.equipLevels).toEqual({
      머리: 5, 몸통: 'T9', 팔: '없음', 다리: 2,
    });
  });

  it('애장품은 SR15 스탯에 단계로, 소장품은 등급+레벨로 읽는다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 0, core: 0 }, { name_code: 5002, grade: 0, core: 0 }],
      details: [
        detailOf({ name_code: 5001, favorite_item_tid: 200101, favorite_item_lv: 2 }),
        detailOf({ name_code: 5002, favorite_item_tid: 100602, favorite_item_lv: 15 }),
      ],
    }), settings, catalog);

    expect(result.overrides['라피']!.collection).toEqual({ stage: 'SR15', favorite: 3 });
    expect(result.overrides['앨리스']!.collection).toEqual({ stage: 'SR15', favorite: 0 });
  });

  it('소장품 슬롯이 비면 미장착으로 적는다 — 기본값이 남으면 과대평가된다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 0, core: 0 }],
      details: [detailOf({ name_code: 5001, favorite_item_tid: 0 })],
    }), settings, catalog);
    expect(result.overrides['라피']!.collection).toEqual({ stage: '없음', favorite: 0 });
  });

  it('낀 큐브를 이름으로 옮기고, 안 꼈으면 손대지 않는다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5001, grade: 0, core: 0 }, { name_code: 5002, grade: 0, core: 0 }],
      details: [
        detailOf({ name_code: 5001, harmony_cube_tid: 1000317, harmony_cube_lv: 15 }),
        detailOf({ name_code: 5002, harmony_cube_tid: 0 }),
      ],
    }), settings, catalog);

    expect(result.overrides['라피']!.cube).toEqual({ name: '렐릭 디바이드 큐브', level: 15 });
    expect(result.overrides['앨리스']!.cube).toBeUndefined();
    expect(result.notes.some((note) => note.includes('큐브를 끼지 않은'))).toBe(true);
  });

  it('스킬 레벨이 잠긴 미공개 캐릭터는 스킬을 건드리지 않는다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 5003, grade: 0, core: 0 }],
      details: [detailOf({ name_code: 5003, skill1_lv: 10, skill2_lv: 10, ulti_skill_lv: 10 })],
    }), settings, catalog);
    expect(result.overrides['미공개']!.skillLevels).toBeUndefined();
  });

  it('사전에 없는 name_code는 건너뛰고 알려 준다', () => {
    const result = areaToOverrides(area({
      characters: [{ name_code: 9999, grade: 0, core: 0 }],
      details: [detailOf({ name_code: 9999 })],
    }), settings, catalog);

    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([9999]);
    expect(result.notes.some((note) => note.includes('아직 다루지 않는'))).toBe(true);
  });
});

describe('pickArea', () => {
  it('사용자가 고른 서버가 있으면 보유 니케 수와 무관하게 그 지역을 고른다', () => {
    const picked = pickArea({
      openid: '1',
      areas: [
        area({ area: 83, characters: [{ name_code: 5001 }, { name_code: 5002 }] }),
        area({ area: 84, characters: [{ name_code: 5001 }] }),
      ],
    }, 84);

    expect(picked?.area).toBe(84);
  });

  it('니케를 가장 많이 가진 지역을 고른다', () => {
    const picked = pickArea({
      openid: '1',
      areas: [
        area({ area: 1, characters: [{ name_code: 5001 }] }),
        area({ area: 83, characters: [{ name_code: 5001 }, { name_code: 5002 }] }),
      ],
    });
    expect(picked?.area).toBe(83);
  });

  it('지역이 하나도 없으면 null', () => {
    expect(pickArea({ openid: '1', areas: [] })).toBeNull();
  });
});

describe('consoleFrom', () => {
  it('재활용 연구실 레벨을 공통·클래스·기업으로 가른다', () => {
    const result = consoleFrom(area({
      outpost: {
        recycle_room_researches: [
          { tid: 1001, lv: 12 },
          { tid: 1101, lv: 8 },
          { tid: 1204, lv: 5 },
          { tid: 9999, lv: 3 },   // 모르는 항목은 무시
        ],
      },
    }));

    // 안 올린 연구실도 0으로 채워 보낸다 — 자리를 비우면 엔진이 «빠진 소속이 있다»로
    // 거절한다(빠진 소속이 조용히 0이 되는 걸 막는 장치라, 우리가 뜻을 분명히 적는다).
    expect(result).toEqual({
      common_level: 12,
      class_level: { 화력형: 8, 방어형: 0, 지원형: 0 },
      company_level: { 필그림: 5, 엘리시온: 0, 미실리스: 0, 테트라: 0, 어브노말: 0 },
    });
  });

  it('전초기지가 비공개면 null — 콘솔은 기본값으로 둔다', () => {
    expect(consoleFrom(area({ outpost: null }))).toBeNull();
    expect(consoleFrom(area({ outpost: { recycle_room_researches: [] } }))).toBeNull();
  });
});
