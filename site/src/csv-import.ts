import type { CharacterOverrides, EquipPart, SettingsCatalog } from './types';

// 렛츠도로 니케정보 CSV → 캐릭터별 override.
// 집계 오버로드 컬럼(우코/공증/…/차속)은 이미 게임식 정수 반올림이 적용된 값이라
// 그대로 쓴다(차속 반올림 포함). 이름은 정식 명칭이 정확히 일치할 때만 적용한다.

const OVERLOAD_BY_HEADER: Record<string, string> = {
  '우코(%)': 'element_bonus',
  '공증(%)': 'atk_pct',
  '방어(%)': 'def_pct',
  '장탄(%)': 'max_ammo_pct',
  '크확(%)': 'crit_rate',
  '크댐(%)': 'crit_dmg',
  '차속(%)': 'charge_speed_pct',
  '차댐(%)': 'charge_dmg_pct',
  '명중(%)': 'accuracy_pct',
};

// 렛츠도로 `소장품` 컬럼 표기 → 계산기 설정.
//   '애장품 ★★★' / '애장품 ★★☆' → 애장품 단계(별 개수). 소장품 슬롯을 공유한다.
//   'SR 15' / 'SR 5' / 'R 0'     → 소장품 등급+레벨 (공백을 지워 'SR15' 형태로)
//   빈 칸                        → 미장착
// 이 컬럼을 읽지 않으면 계산기 기본값(SR15 + 애장품 3단계)이 그대로 적용돼,
// 실제로 안 낀 캐릭터가 과대평가된다.
export function parseCollection(raw: string | undefined): { stage: string; favorite: number } {
  const text = (raw ?? '').trim();
  if (text === '') return { stage: '없음', favorite: 0 };
  const stars = text.match(/★/g);
  if (stars) return { stage: 'SR15', favorite: Math.min(3, stars.length) };
  const graded = text.replace(/\s+/g, '').toUpperCase().match(/^(SR|R)(\d{1,2})$/);
  if (graded) return { stage: `${graded[1]}${Number(graded[2])}`, favorite: 0 };
  // 모르는 표기는 건드리지 않는다 — 기본값이 그대로 남는 편이 잘못 낮추는 것보다 낫다.
  return { stage: '', favorite: 0 };
}

const EQUIP_LEVEL_HEADER: Record<EquipPart, string> = {
  머리: '머리_레벨',
  몸통: '몸통_레벨',
  팔: '장갑_레벨',
  다리: '다리_레벨',
};

export interface RosterImport {
  overrides: Record<string, CharacterOverrides>;
  matched: string[];
  unmatched: string[];
}

/** CSV 한 줄을 필드 배열로 (따옴표·따옴표 내 콤마 처리). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(field); field = ''; }
    else field += ch;
  }
  fields.push(field);
  return fields;
}

const toInt = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const toNum = (value: string | undefined): number => {
  const n = Number((value ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** 렛츠도로 CSV 텍스트를 캐릭터별 override로 변환한다. */
export function parseRosterCsv(text: string, settings: SettingsCatalog): RosterImport {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  const overrides: Record<string, CharacterOverrides> = {};
  const matched: string[] = [];
  const unmatched: string[] = [];
  if (lines.length < 2) return { overrides, matched, unmatched };

  const header = parseCsvLine(lines[0]!);
  const col = (name: string): number => header.indexOf(name);
  const at = (row: string[], name: string): string | undefined => {
    const index = col(name);
    return index >= 0 ? row[index] : undefined;
  };

  for (let r = 1; r < lines.length; r += 1) {
    const row = parseCsvLine(lines[r]!);
    const name = (at(row, '이름') ?? '').trim();
    if (!name) continue;
    const defaults = settings.characters[name];
    if (!defaults) { unmatched.push(name); continue; }

    const override: CharacterOverrides = {};

    const overload: Record<string, number> = {};
    for (const [headerName, key] of Object.entries(OVERLOAD_BY_HEADER)) {
      overload[key] = toNum(at(row, headerName));
    }
    override.overload = overload;

    const breakthrough = toInt(at(row, '돌파')) ?? 0;
    const core = toInt(at(row, '코강')) ?? 0;
    override.growthStage = clamp(breakthrough + core, 0, defaults.maxGrowthStage);

    if (!defaults.skillLevelsLocked) {
      const s1 = toInt(at(row, '스킬1'));
      const s2 = toInt(at(row, '스킬2'));
      const s3 = toInt(at(row, '버스트스킬'));
      if (s1 && s2 && s3) {
        override.skillLevels = {
          '1': clamp(s1, 1, 10), '2': clamp(s2, 1, 10), '3': clamp(s3, 1, 10),
        };
      }
    }

    const collection = parseCollection(at(row, '소장품'));
    if (collection.stage !== '') override.collection = collection;

    const equipLevels: Partial<Record<EquipPart, number>> = {};
    for (const part of Object.keys(EQUIP_LEVEL_HEADER) as EquipPart[]) {
      const level = toInt(at(row, EQUIP_LEVEL_HEADER[part]));
      if (level !== null) equipLevels[part] = clamp(level, 0, 5);
    }
    if (Object.keys(equipLevels).length > 0) override.equipLevels = equipLevels;

    overrides[name] = override;
    matched.push(name);
  }

  return { overrides, matched, unmatched };
}
