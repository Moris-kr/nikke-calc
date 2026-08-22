import type { CharacterOverrides, EquipPart, SettingsCatalog } from './types';

// blablalink 육성 프로필(`profiles/<이름>.json`, `scraper/profile_fetch.py`가 만든다)
// → 캐릭터별 override.
//
// CSV(렛츠도로)보다 정확하다: 오버로드가 **줄별 값**으로 오고(최대 장탄·차지 속도는
// 줄마다 따로 반올림되므로 합산 값으로는 정확히 못 낸다), 장비 강화 단계·소장품·
// 애장품 단계가 계산기 필드 그대로 들어 있다.
//
// 브라우저가 blablalink API를 직접 부르지는 않는다 — 그쪽은 계정 세션 쿠키가 필요하고
// 교차 출처 호출도 막혀 있다. 로컬에서 스크립트로 받은 프로필 파일만 읽는다.

const EQUIP_PART_KEYS: EquipPart[] = ['머리', '몸통', '팔', '다리'];

export interface ProfileImport {
  overrides: Record<string, CharacterOverrides>;
  matched: string[];
  unmatched: string[];
  meta: { name?: string; fetchedAt?: string; roster?: number };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** 육성 프로필 JSON → 캐릭터별 override. 카탈로그에 없는 이름은 건너뛴다. */
export function parseProfileJson(text: string, settings: SettingsCatalog): ProfileImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('프로필 JSON을 읽지 못했습니다. profiles/<이름>.json 파일을 그대로 올려 주세요.');
  }
  if (!isRecord(data) || !isRecord(data.chars)) {
    throw new Error('`chars` 키가 없습니다 — profile_fetch.py가 만든 육성 프로필이 아닙니다.');
  }

  const metaRaw = isRecord(data._meta) ? data._meta : {};
  const meta = {
    name: typeof metaRaw.name === 'string' ? metaRaw.name : undefined,
    fetchedAt: typeof metaRaw.fetched_at === 'string' ? metaRaw.fetched_at : undefined,
    roster: num(metaRaw.roster) ?? undefined,
  };

  const overrides: Record<string, CharacterOverrides> = {};
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const [name, entryRaw] of Object.entries(data.chars)) {
    if (!isRecord(entryRaw)) continue;
    const defaults = settings.characters[name];
    if (!defaults) { unmatched.push(name); continue; }

    const override: CharacterOverrides = {};

    // 돌파 + 코강 → 성장 단계(웹은 한 축으로 받는다). 캐릭터 등급 상한으로 자른다.
    const breakthrough = num(entryRaw.breakthrough) ?? 0;
    const core = num(entryRaw.core_enhancement) ?? 0;
    override.growthStage = clamp(
      Math.trunc(breakthrough + core), 0, defaults.maxGrowthStage,
    );

    const skills = entryRaw.skill_levels;
    if (isRecord(skills) && !defaults.skillLevelsLocked) {
      const s1 = num(skills['1']); const s2 = num(skills['2']); const s3 = num(skills['3']);
      if (s1 && s2 && s3) {
        override.skillLevels = {
          '1': clamp(Math.trunc(s1), 1, 10),
          '2': clamp(Math.trunc(s2), 1, 10),
          '3': clamp(Math.trunc(s3), 1, 10),
        };
      }
    }

    // 오버로드: 줄별 리스트는 그대로 넘긴다 — 최대 장탄·차지 속도는 줄마다 따로
    // 반올림되므로 합쳐 버리면 실제 게임과 어긋난다(엔진이 리스트를 줄별로 받는다).
    const equipSkills = entryRaw.equip_skills;
    if (isRecord(equipSkills)) {
      const overload: Record<string, number | number[]> = {};
      for (const [key, value] of Object.entries(equipSkills)) {
        if (!(key in settings.overloadFields)) continue;
        if (Array.isArray(value)) {
          const lines = value.map(num).filter((v): v is number => v !== null && v > 0);
          if (lines.length > 0) overload[key] = lines;
        } else {
          const scalar = num(value);
          if (scalar !== null) overload[key] = scalar;
        }
      }
      if (Object.keys(overload).length > 0) override.overload = overload;
    }

    // 장비: 기업 T10만 강화 단계(0~5)를 갖는다. 그 아래 티어·미장착은 0강으로 친다.
    const equipment = entryRaw.equipment;
    if (isRecord(equipment)) {
      const equipLevels: Partial<Record<EquipPart, number>> = {};
      for (const part of EQUIP_PART_KEYS) {
        const slot = equipment[part];
        const level = isRecord(slot) ? num(slot.level) : null;
        equipLevels[part] = level === null ? 0 : clamp(Math.trunc(level), 0, 5);
      }
      override.equipLevels = equipLevels;
    }

    // 소장품 / 애장품 — 둘은 같은 슬롯이라 한 설정으로 간다.
    const stage = typeof entryRaw.collection_stage === 'string' ? entryRaw.collection_stage : '';
    const favorite = num(entryRaw.favorite_stage);
    if (favorite !== null && favorite > 0) {
      override.collection = { stage: 'SR15', favorite: clamp(Math.trunc(favorite), 1, 3) };
    } else if (stage) {
      override.collection = { stage, favorite: 0 };
    }

    overrides[name] = override;
    matched.push(name);
  }

  return { overrides, matched, unmatched, meta };
}
