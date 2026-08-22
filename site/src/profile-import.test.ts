import { describe, expect, it } from 'vitest';

import { parseProfileJson } from './profile-import';
import type { CharacterSettingsDefaults, SettingsCatalog } from './types';

const charDefaults = (over: Partial<CharacterSettingsDefaults> = {}): CharacterSettingsDefaults => ({
  weaponType: 'SR', recommendedControl: {}, hasConditionalControl: false,
  growthStage: 3, rarity: 'SSR', maxGrowthStage: 10, growthOptions: [],
  skillLevels: { '1': 10, '2': 10, '3': 10 }, skillLevelsLocked: false,
  overload: {}, cube: { name: '렐릭 베어 큐브', level: 15 },
  collection: { stage: 'SR15', favorite: 0 },
  ...over,
});

const settings = {
  characters: { 앨리스: charDefaults(), 프리바티: charDefaults({ maxGrowthStage: 0 }) },
  overloadFields: {
    atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 },
    max_ammo_pct: { label: '최대 장탄수', unit: '%', min: 0, max: 10000 },
    charge_speed_pct: { label: '차지 속도', unit: '%', min: 0, max: 1000 },
  },
} as unknown as SettingsCatalog;

const profile = (chars: Record<string, unknown>) => JSON.stringify({
  _meta: { name: 'me', fetched_at: '2026-08-23T10:00:00+09:00', roster: 2 },
  _account: {},
  chars,
});

describe('parseProfileJson', () => {
  it('maps growth, skills, per-line overload, equipment, and collection', () => {
    const text = profile({
      앨리스: {
        breakthrough: 3, core_enhancement: 7, affinity: 30,
        skill_levels: { '1': 10, '2': 5, '3': 10 },
        // 줄별 리스트는 그대로 유지돼야 한다 — 합치면 게임과 수치가 어긋난다.
        equip_skills: { atk_pct: 43.03, max_ammo_pct: [64.82, 44.28], charge_speed_pct: [4.92, 4.63] },
        equipment: { 머리: { level: 5 }, 몸통: { level: 3 }, 팔: { tier: 'T9' }, 다리: { tier: '없음' } },
        collection_stage: 'SR15',
      },
      모르는캐릭: { breakthrough: 3 },
    });

    const { overrides, matched, unmatched, meta } = parseProfileJson(text, settings);
    expect(matched).toEqual(['앨리스']);
    expect(unmatched).toEqual(['모르는캐릭']);
    expect(meta.fetchedAt).toBe('2026-08-23T10:00:00+09:00');

    const alice = overrides['앨리스']!;
    expect(alice.growthStage).toBe(10);
    expect(alice.skillLevels).toEqual({ '1': 10, '2': 5, '3': 10 });
    expect(alice.overload).toEqual({
      atk_pct: 43.03, max_ammo_pct: [64.82, 44.28], charge_speed_pct: [4.92, 4.63],
    });
    // 기업 T10만 강화 단계를 갖는다 — 그 아래 티어·미장착은 0강
    expect(alice.equipLevels).toEqual({ 머리: 5, 몸통: 3, 팔: 0, 다리: 0 });
    expect(alice.collection).toEqual({ stage: 'SR15', favorite: 0 });
  });

  it('treats a favorite item as the shared collection slot', () => {
    const { overrides } = parseProfileJson(profile({
      앨리스: { breakthrough: 3, collection_stage: 'SR15', favorite_stage: 2 },
    }), settings);
    expect(overrides['앨리스']!.collection).toEqual({ stage: 'SR15', favorite: 2 });
  });

  it('clamps growth to the character rarity limit', () => {
    const { overrides } = parseProfileJson(profile({
      프리바티: { breakthrough: 3, core_enhancement: 7 },
    }), settings);
    expect(overrides['프리바티']!.growthStage).toBe(0);
  });

  it('drops overload keys the calculator does not expose', () => {
    const { overrides } = parseProfileJson(profile({
      앨리스: { breakthrough: 0, equip_skills: { atk_pct: 10, 알수없음: 99 } },
    }), settings);
    expect(overrides['앨리스']!.overload).toEqual({ atk_pct: 10 });
  });

  it('rejects files that are not a growth profile', () => {
    expect(() => parseProfileJson('not json', settings)).toThrow(/프로필 JSON/);
    expect(() => parseProfileJson('{"foo":1}', settings)).toThrow(/chars/);
  });
});
