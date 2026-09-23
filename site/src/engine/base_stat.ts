/**
 * Phase 2: 기본 스탯 계산기
 *
 * 공식:
 *   (레벨스탯 + (레벨스탯×0.02+20) × 돌파수 + 호감도스탯 + 콘솔스탯)
 *   × (1 + 0.02×코강수)
 *   + 장비스탯 + 큐브스탯 + 소장품스탯
 *
 * 이식: calculator/base_stat.py (캐릭터 인스턴스 구조는 원본 docstring 참고)
 *
 * 파이썬은 모듈을 불러올 때 표를 읽지만, 여기서는 함수 안에서 `data()`로 꺼낸다.
 * 표에서 계산해 두는 모듈 상수(BAND·_BAND_RATIOS·_BAND_SHARES·_RATIO_TAIL·_SHARE_TAIL)는
 * 처음 쓸 때 한 번 만들고, 데이터가 바뀌면(`onDataChange`) 비운다.
 */
import { data, onDataChange } from './data';
import { floordiv, get, has, item, KeyError, round, sorted, sum, int, float, truthy } from './py';

type Stat = Record<string, number>;

// ── 테이블 (파이썬: 모듈 임포트 시 1회 로드 → 여기서는 호출 시 data()에서) ─────────
function _NIKKE(): Record<string, any> { return data().parsed_nikke; }
function _LEVEL_STATS(): Record<string, any> { return data().tables.level_stats; }
function _AFFINITY(): Record<string, any> { return data().tables.affinity; }
function _CONSOLE(): Record<string, any> { return data().tables.console; }
function _EQUIP_STATS(): Record<string, any> { return data().tables.equipment_stats; }
function _CUBE(): Record<string, any> { return data().tables.cube; }
function _COLLECTION(): Record<string, any> { return data().tables.collection; }

// 미장착 표현. 장비 `tier`와 `collection_stage`가 공유한다.
// **기업 강화0·R0과 구분해야 한다** — 그쪽은 "가장 낮은 장착 상태"라 플랫 스탯이 붙는다
// (기업 머리 강화0 = 방어형 기준 +4010 atk). 실제 계정 스펙에는 빈 슬롯이 흔하다.
export const NO_ITEM = '없음';

// 파이썬 repr(str) — 작은따옴표(안에 작은따옴표만 있으면 큰따옴표).
function _repr_str(s: string): string {
  if (s.includes("'") && !s.includes('"')) return `"${s}"`;
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function _is_dict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────

// py: calculator/base_stat.py:64
function _zero(): Stat {
  return { atk: 0.0, def: 0.0, hp: 0.0 };
}

// py: calculator/base_stat.py:68
function _add(a: Stat, b: Stat): Stat {
  return {
    atk: item(a, 'atk') + item(b, 'atk'),
    def: item(a, 'def') + item(b, 'def'),
    hp: item(a, 'hp') + item(b, 'hp'),
  };
}

// py: calculator/base_stat.py:74
function _scale(s: Stat, k: number): Stat {
  return { atk: item(s, 'atk') * k, def: item(s, 'def') * k, hp: item(s, 'hp') * k };
}

// 레벨 스탯표는 20레벨이 한 «밴드»다. 밴드 안에서는 레벨당 증가분이 일정하고,
// 밴드가 바뀌는 자리(레벨 ≡ 1 mod 20)에서 한 번 크게 뛴다. (원본 주석 참고)
// 표 밖은 `level_beyond.json`의 **실측 비율**로 잇고, 실측이 닿지 않는 위쪽만 그 비율로 맞춘
// 꼬리로 연장한다.

interface _BeyondConsts {
  BAND: number;
  _BAND_RATIOS: Map<number, number>;
  _BAND_SHARES: Map<number, number>;
  _RATIO_TAIL: [number, number];
  _SHARE_TAIL: [number, number];
}

let _consts_cache: _BeyondConsts | null = null;

/**
 * 파이썬 모듈 상수 `BAND`. 데이터를 넣은 뒤 처음 `_consts()`가 불리면 채워진다(ESM 라이브 바인딩).
 * 확실히 읽으려면 `band_size()`를 쓴다.
 */
export let BAND = 0;

onDataChange.push(() => {
  _consts_cache = null;
});

// py: calculator/base_stat.py:86-107 (모듈 수준 상수 계산)
function _consts(): _BeyondConsts {
  if (_consts_cache !== null) return _consts_cache;
  const _BEYOND: Record<string, any> = data().tables.level_beyond;
  const band = int(item(_BEYOND, 'band'));
  const ratios = new Map<number, number>();
  for (const [k, v] of Object.entries(item<Record<string, any>>(_BEYOND, 'ratios'))) {
    ratios.set(int(k), float(v));
  }
  // 밴드 상승분 중 «고르게 오르는 몫»의 비중. 나머지는 밴드 경계에서 한 번에 뛴다.
  const shares = new Map<number, number>();
  for (const [k, v] of Object.entries(item<Record<string, any>>(_BEYOND, 'shares'))) {
    shares.set(int(k), float(v));
  }
  const ratioSeries = new Map<number, number>();
  for (const [b, r] of ratios) ratioSeries.set(b, r - 1);
  _consts_cache = {
    BAND: band,
    _BAND_RATIOS: ratios,
    _BAND_SHARES: shares,
    _RATIO_TAIL: _power_fit(ratioSeries),
    _SHARE_TAIL: _power_fit(shares),
  };
  BAND = band;
  return _consts_cache;
}

/** `BAND` 값을 확실히(데이터에서) 읽는다. */
export function band_size(): number {
  return _consts().BAND;
}

// py: calculator/base_stat.py:94
function _power_fit(series: Map<number, number>): [number, number] {
  /** `ln(y) = i + s·ln(b)`를 맞춘다 — 실측이 끝난 뒤를 잇는 꼬리. */
  const points: [number, number][] = [];
  for (const [b, y] of sorted([...series.entries()])) {
    if (y > 0) points.push([Math.log(b), Math.log(y)]);
  }
  const n = points.length;
  const mx = sum(points.map(([x]) => x)) / n;
  const my = sum(points.map(([, y]) => y)) / n;
  const denom = sum(points.map(([x]) => { const d = x - mx; return d * d; }));
  const slope = sum(points.map(([x, y]) => (x - mx) * (y - my))) / denom;
  return [slope, my - slope * mx];
}

// py: calculator/base_stat.py:110
function _tail(fit: [number, number], band: number): number {
  const [slope, inter] = fit;
  return Math.exp(inter + slope * Math.log(Math.max(band, 1)));
}

// py: calculator/base_stat.py:116
/** 밴드 하나의 상승 비율. 실측이 있으면 실측, 없으면 그 실측으로 맞춘 꼬리. */
export function band_ratio(band: number): number {
  const c = _consts();
  if (c._BAND_RATIOS.has(band)) {
    return c._BAND_RATIOS.get(band)!;
  }
  return 1 + _tail(c._RATIO_TAIL, band);
}

// py: calculator/base_stat.py:123
/** 밴드 안에서 고르게 오르는 몫의 비중. */
export function band_share(band: number): number {
  const c = _consts();
  if (c._BAND_SHARES.has(band)) {
    return c._BAND_SHARES.get(band)!;
  }
  return _tail(c._SHARE_TAIL, band);
}

// py: calculator/base_stat.py:130
/** 표 끝 위쪽을 잇는다. 밴드 모양(고르게 오르다 한 번 뛴다)까지 그대로 흉내 낸다. */
export function _beyond_table(table: Record<string, any>, keys: string[], level: number): Stat {
  const BAND_ = _consts().BAND;
  const top = int(keys[keys.length - 1]!);
  const start_level = top - (top - 1) % BAND_; // 표 마지막 밴드의 시작 레벨 (1000이면 981)
  let value: Stat = {};
  for (const [k, v] of Object.entries(item<Record<string, any>>(table, String(start_level)))) {
    value[k] = float(v);
  }
  let band = floordiv(start_level - 1, BAND_);
  while (true) {
    const ratio = band_ratio(band);
    const gap: Stat = {};
    for (const [k, v] of Object.entries(value)) gap[k] = v * (ratio - 1);
    const band_start = band * BAND_ + 1;
    if (band_start <= level && level < band_start + BAND_) {
      const offset = level - band_start;
      if (offset === 0) {
        const out: Stat = {};
        for (const [k, v] of Object.entries(value)) out[k] = round(v);
        return out;
      }
      const share = band_share(band);
      const out: Stat = {};
      for (const k of Object.keys(value)) {
        out[k] = round(value[k]! + gap[k]! * share * offset / (BAND_ - 1));
      }
      return out;
    }
    const next: Stat = {};
    for (const k of Object.keys(value)) next[k] = value[k]! + gap[k]!;
    value = next;
    band += 1;
  }
}

// py: calculator/base_stat.py:151
/**
 * level_stats.json 조회. 키 없는 레벨은 인접 두 키로 선형 보간.
 * 표 끝(1000)을 넘는 레벨은 `_beyond_table()`이 잇는다 — **추정치다**.
 */
export function _level_stat(name: string, rarity: string, cls: string, weapon: string, level: number): Stat {
  const LS = _LEVEL_STATS();
  const exc = get(get(LS, '_exceptions', {}), name);
  const combo: string = truthy(exc) ? exc : `${rarity}_${cls}_${weapon}`;
  const table = get(LS, combo);
  if (table == null) {
    throw KeyError(
      `[${name}] level_stats.json에 ${_repr_str(combo)} 조합이 없다 — 등급·클래스·무기유형 중 ` +
      '하나가 표에 없는 값이다. 예외로 둘 캐릭터면 `_exceptions`에 적는다',
    );
  }
  const key = String(level);
  if (has(table, key)) {
    return { ...table[key] };
  }

  const keys = sorted(Object.keys(table), (k) => int(k));
  const levels = keys.map((k) => int(k));
  if (level <= levels[0]!) {
    return { ...item(table, keys[0]!) };
  }
  if (level > levels[levels.length - 1]!) {
    return _beyond_table(table, keys, level);
  }

  for (let i = 0; i < levels.length - 1; i += 1) {
    const lo = levels[i]!;
    const hi = levels[i + 1]!;
    if (lo < level && level < hi) {
      const t = (level - lo) / (hi - lo);
      const lo_s = item(table, String(lo));
      const hi_s = item(table, String(hi));
      return {
        atk: lo_s['atk'] + t * (hi_s['atk'] - lo_s['atk']),
        def: lo_s['def'] + t * (hi_s['def'] - lo_s['def']),
        hp: lo_s['hp'] + t * (hi_s['hp'] - lo_s['hp']),
      };
    }
  }
  // 파이썬은 여기서 암묵적으로 None을 돌려준다.
  return null as unknown as Stat;
}

// T9 기업 장비의 배수. 인게임 식은 `기본값 × (1 + 0.3×기업일치 + 0.1×강화단계)`이고
// 두 항은 **곱이 아니라 합**이다 (blablalink 프론트 `getEquipAttr`).
export const CORP_MATCH_BONUS = 0.3;
export const GEAR_LEVEL_BONUS = 0.1;

// py: calculator/base_stat.py:198
/**
 * 부위 하나의 플랫 스탯. `tier` 없으면 오버로드 장비(강화 `level` 단계)다.
 * 인게임은 부위마다 반올림한 뒤 합치므로 여기서도 부위 단위로 반올림한다.
 */
export function _equip_stat(cls: string, part: string, part_data: Record<string, any>, corp: string | null = null): Stat {
  const tier = get(part_data, 'tier');
  if (tier === NO_ITEM) {
    return _zero();
  }
  const ES = _EQUIP_STATS();
  if (tier == null || tier === '기업') {
    return item(item(item(item(ES, '기업'), cls), part), String(item(part_data, 'level')));
  }
  const base: Stat = item(item(item(item(ES, '일반'), tier), cls), part);
  const gear_corp = get(part_data, 'corp');
  if (!truthy(gear_corp)) {
    return base;
  }
  let mult = 1 + GEAR_LEVEL_BONUS * get(part_data, 'level', 0);
  if (gear_corp === corp) {
    mult += CORP_MATCH_BONUS;
  }
  const out: Stat = {};
  for (const [k, v] of Object.entries(base)) out[k] = round(v * mult);
  return out;
}

// py: calculator/base_stat.py:225
/** 콘솔 레벨 하나를 뽑는다. 값이 dict면 `bucket`(역할군 또는 기업)으로 고른다. */
export function console_level(console: Record<string, any>, key: string, bucket: string, name: string): number {
  const val = item(console, key);
  if (!_is_dict(val)) {
    return val;
  }
  if (!has(val, bucket)) {
    const ks = sorted(Object.keys(val)).map(_repr_str).join(', ');
    throw KeyError(
      `[${name}] console.${key}에 ${_repr_str(bucket)}이 없다 (있는 키: [${ks}]). ` +
      '역할군/기업별로 적었으면 전부 적어야 한다 — 빠진 소속이 조용히 0이 되면 안 된다.');
  }
  return val[bucket];
}

// py: calculator/base_stat.py:242
/** 소장품 단계의 플랫 스탯. `"없음"`(미장착)은 0. */
export function collection_stat(stage: string): Stat {
  if (stage === NO_ITEM) {
    return _zero();
  }
  const entry = get(item(_COLLECTION(), '_stat_table'), stage);
  if (entry == null) {
    throw KeyError(
      `알 수 없는 소장품 단계 ${_repr_str(String(stage))} — 'R0'~'R15' · 'SR0'~'SR15' 또는 '없음'(미장착)`);
  }
  return { atk: item(entry, 'atk'), def: item(entry, 'def'), hp: item(entry, 'hp') };
}

// py: calculator/base_stat.py:257
/** 레벨스탯 단일 값에 DealForm ② b 공식 적용. */
function _core_formula(lv_val: number, bt: number): number {
  return lv_val + (lv_val * 0.02 + 20) * bt;
}

// ── 메인 계산 함수 ────────────────────────────────────────────────────────

// py: calculator/base_stat.py:264
/**
 * 캐릭터 인스턴스 → 기본 ATK / DEF / HP 반환.
 * 반환: {"atk": int, "def": int, "hp": int}
 */
export function calc_base_stats(char: Record<string, any>): Stat {
  const name = item(char, 'name');
  const level = item(char, 'level');
  const bt = item(char, 'breakthrough');
  const core_enh = item(char, 'core_enhancement');
  const affinity = item(char, 'affinity');
  const equip_inst = item(char, 'equipment');
  const cube_inst = item(char, 'cube');
  const console = item(char, 'console');
  const coll_stage = item(char, 'collection_stage');

  // 캐릭터 메타
  const meta = item(_NIKKE(), name);
  const cls = item(meta, 'class');
  const weapon = item(meta, 'weapon_type');
  const rarity = get(meta, 'rarity', 'SSR');

  // 레벨스탯 — 등급까지 봐야 SR·R이 SSR 곡선을 빌려 쓰지 않는다
  const lv_s = _level_stat(name, rarity, cls, weapon, level);

  // 코어공식 (atk/def/hp 각각)
  const core: Stat = {
    atk: _core_formula(lv_s['atk']!, bt),
    def: _core_formula(lv_s['def']!, bt),
    hp: _core_formula(lv_s['hp']!, bt),
  };

  // 호감도 스탯
  const aff_s = item(item(_AFFINITY(), cls), String(affinity));

  // 콘솔 스탯 (공통 + 역할군 + 기업). 역할군·기업은 소속별로 레벨이 다를 수 있다.
  let con_s = _zero();
  const CON = _CONSOLE();
  for (const [con_type, level_key, bucket] of [
    ['공통', 'common_level', ''],
    ['클래스', 'class_level', cls],
    ['기업', 'company_level', item(meta, 'manufacturer')],
  ] as [string, string, string][]) {
    const per = item(item(CON, con_type), 'per_level');
    con_s = _add(con_s, _scale(per, console_level(console, level_key, bucket, name)));
  }

  // 코강 적용 전 합계 → 코강 반영
  const pre_scaled = _scale(
    _add(_add(core, aff_s), con_s),
    1 + 0.02 * core_enh,
  );

  // 장비 플랫 스탯 (4부위 합산)
  let equip_s = _zero();
  for (const [part, part_data] of Object.entries(equip_inst as Record<string, any>)) {
    equip_s = _add(equip_s, _equip_stat(cls, part, part_data, item(meta, 'manufacturer')));
  }

  // 큐브 플랫 스탯. 「없음」은 큐브를 아예 안 낀 상태라 스탯도 붙지 않는다
  // (미란다처럼 큐브 효과가 오히려 손해인 조합을 재려고 둔 선택지다).
  const cube_s = get(cube_inst, 'name') === '없음'
    ? _zero()
    : item(item(_CUBE(), '_stats'), String(item(cube_inst, 'level')));

  // 소장품 플랫 스탯
  const coll_s = collection_stat(coll_stage);

  // 최종 합산
  const total = _add(_add(_add(pre_scaled, equip_s), cube_s), coll_s);
  return {
    atk: round(total['atk']!),
    def: round(total['def']!),
    hp: round(total['hp']!),
  };
}

// py: calculator/base_stat.py:333
/**
 * HP → ATK 전환. 스킬 텍스트 '최대 HP의 N%를 공격력으로' 대응.
 * ratio: 소수 (5% → 0.05)
 */
export function hp_to_atk(hp: number, ratio: number): number {
  return hp * ratio;
}
