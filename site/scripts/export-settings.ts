/**
 * 브라우저 설정 메타데이터(site/public/settings.json)를 엔진 정본 자료에서 뽑는다.
 * `site/scripts/export-settings.py`를 옮긴 것이다 — 출력은 파이썬 `json.dump(indent=2)` + 줄바꿈과 바이트까지 같다.
 *
 *     cd site && npx tsx scripts/export-settings.ts > public/settings.json
 *
 * 보통은 `npm run sync-runtime`(scripts/sync-runtime.mjs)이 부른다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUFF_TARGET_WATCH, COLLECTION_STAGES, CONSOLE_CLASSES, CONSOLE_COMPANIES, CUBE_NAMES, MANUAL_STATS,
  OPTIMAL_RANGE_WEAPONS, OVERLOAD_FIELDS, WEAPON_TYPES, _is_float,
} from '../src/engine/customization';
import { data } from '../src/engine/data';
import { growth_options, growth_profile } from '../src/engine/growth';
import { float, int, round, sorted, truthy } from '../src/engine/py';
import { _CHAR_DEFAULTS, build_squad } from '../src/engine/spec';
import { ROOT, loadEngine, runMain } from './lib/engine';
import { PyFloat, loadMarked, loadOrdered, pyDumps } from './lib/pyjson';

const readJson = (rel: string): any => loadMarked(readFileSync(join(ROOT, rel), 'utf-8'));

/** 파이썬 `str.casefold` — 캐릭터 이름에 쓰이는 글자 범위에서는 소문자화와 같다(ß만 따로). */
const casefold = (s: string): string => s.toLowerCase().replace(/ß/g, 'ss');

/** 파이썬 `float(x)` — 결과는 늘 float로 적힌다. */
const F = (x: unknown): PyFloat => new PyFloat(float(x as number));

/** 파이썬 `x.get(k, d)` — 키가 있으면 값이 None이어도 그대로. */
const pget = (d: any, k: string, dflt: any): any =>
  (d != null && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : dflt);

export function exportSettings(): string {
  loadEngine({ marked: true });
  const nikke = data().parsed_nikke;
  const skills = data().parsed_skills;
  const raw = readJson('scraper/nikke_scraped.json');
  const mechanics = data().weapon_mechanics;
  const cube_table = data().tables.cube;
  const CHAR_DEFAULTS = _CHAR_DEFAULTS();

  const characters = new Map<string, unknown>();
  const names = sorted(
    Object.keys(skills).filter((n) => !n.startsWith('test_') && Object.prototype.hasOwnProperty.call(nikke, n)),
    casefold,
  );
  for (const name of names) {
    const meta = nikke[name];
    const profile = growth_profile(name, meta);
    // 조합 조건부 컨트롤 중 «누가 함께 있는가»만 보는 규칙은 화면이 스스로 판정할 수
    // 있다 — 스쿼드만 있으면 되기 때문이다. 그런 규칙만 내려보내, 카드가 «지금 이
    // 조합에서 실제로 걸리는 컨트롤»을 계산 전에도 적을 수 있게 한다.
    // 다른 조건(같은 단계·자리 번호)을 쓰는 규칙은 내려보내지 않는다. 화면이 판정할
    // 수 없는 것을 흉내 내면 틀린 값을 자신 있게 적게 되므로, 그쪽은 예전처럼
    // «조합에 따라 추가됩니다»라고만 알린다(`hasConditionalControl`).
    const defaults = pget(CHAR_DEFAULTS, name, null) || {};
    const member_rules: unknown[] = [];
    for (const rule of (defaults['_control_rules'] || []) as any[]) {
      const whenKeys = Object.keys(rule['when'] || {});
      if (!(whenKeys.length === 1 && whenKeys[0] === 'with_member' && truthy(rule['control']))) continue;
      member_rules.push({
        withMembers: [...rule['when']['with_member']],
        control: rule['control'] || {},
        // `_help`는 **화면에 그대로 보일 설명**이다. 같은 자리의 `_note`는
        // 유지보수용이라(문서 포인터·전제 조건) 내보내지 않는다.
        ...(truthy(rule['_help']) ? { help: rule['_help'] } : {}),
      });
    }
    const char = build_squad([name])[0]!;
    const equip = char['equip_skills'];
    const favorite = (pget(raw, name, null) || {})['애장품'];
    const skillLevels: Record<string, number> = {};
    for (const [key, value] of Object.entries(char['skill_levels'] as Record<string, any>)) skillLevels[key] = int(value);
    const overload: Record<string, PyFloat> = {};
    for (const key of Object.keys(OVERLOAD_FIELDS)) overload[key] = F(pget(equip, key, 0.0));
    characters.set(name, {
      weaponType: meta['weapon_type'],
      recommendedControl: truthy(char['control']) ? char['control'] : {},
      hasConditionalControl: truthy(defaults['_control_rules']),
      ...(member_rules.length ? { conditionalControl: member_rules } : {}),
      ...(truthy(favorite) ? { favoriteItem: { name: favorite['아이템명'], stage: 3 } } : {}),
      skillLevels,
      skillLevelsLocked: truthy(nikke[name]['preview']),
      growthStage: profile['default_stage'],
      rarity: profile['rarity'],
      maxGrowthStage: profile['max_stage'],
      growthOptions: growth_options(name, meta),
      overload,
      cube: char['cube'],
      // 기본 스펙은 소장품 SR15이고, 애장품이 있는 캐릭터는 3단계로 본다
      // (`src/engine/spec.ts` §기본 육성 스펙). 실제 보유는 유저가 고른다.
      collection: {
        stage: String(char['collection_stage']),
        favorite: truthy(favorite) ? int(char['favorite_stage']) : 0,
      },
    });
  }

  const cubes = new Map<string, unknown>();
  const common_values = cube_table['공통']['values'];
  for (const name of CUBE_NAMES) {
    const entry = cube_table[name];
    const levels: Record<string, unknown> = {};
    for (let level = 1; level < 16; level += 1) {
      const key = String(level);
      const stats = cube_table['_stats'][key];
      // `공통`(우월 코드)은 큐브 레벨 1~4 구간에 스킬 레벨이 없어 키가 아예 빠져
      // 있다 (cube.json `_level_note`). 그 구간은 효과가 붙지 않으므로 0이다.
      const common = pget(common_values, key, null);
      levels[key] = {
        atk: int(stats['atk']),
        def: int(stats['def']),
        hp: int(stats['hp']),
        effect: F(entry['values'][key][0]),
        commonElement: truthy(common) ? F(common[0]) : new PyFloat(0.0),
      };
    }
    cubes.set(name, {
      label: name,
      // 게임 내부 id. 블라블라링크 응답의 `harmony_cube_tid`가 이 값이라
      // 프로필 동기화가 큐브를 알아보려면 필요하다.
      id: int(entry['id']),
      stat: entry['stat'],
      template: entry['template'],
      levels,
      // 계산기가 스킬을 아직 처리하지 못하는 큐브. 공격력·방어력·체력과 공통
      // 우월 코드 효과는 그대로 붙고, 고유 스킬만 빠진다.
      ...(truthy(entry['unsupported']) ? { unsupported: entry['unsupported'] } : {}),
    });
  }

  // 오버로드 옵션의 레벨별 값. 화면이 «부위 3줄»로 고르려면 이 표가 있어야 한다.
  const EQUIP_SKILL_TABLE = data().tables.equipment_skills;
  const overloadSteps = new Map<string, unknown>();
  for (const [option, spec] of Object.entries(EQUIP_SKILL_TABLE as Record<string, any>)) {
    if (option.startsWith('_')) continue;
    const values = spec['values'] as number[];
    // 파이썬 `round(v * 100, 4)` — float면 float, int면 int로 남는다.
    overloadSteps.set(option, values.map((v, i) => (_is_float(values, i) ? new PyFloat(round(v * 100, 4)) : v * 100)));
  }

  const accuracy = pget(mechanics, 'accuracy', {});
  const payload = {
    characters,
    cubes,
    collectionStages: [...COLLECTION_STAGES],
    // 콘솔 소속. 엔진이 빠진 소속을 에러로 끊으므로 목록의 정본을 넘긴다.
    weaponTypes: [...WEAPON_TYPES],
    // 오버로드 옵션의 레벨별 값(9종 × 1~15). 화면이 «부위 3줄»로 고르게 하려면
    // 레벨을 퍼센트로 옮길 표가 필요하다 — 정본은 엔진과 같은
    // `data/base_stat_tables/equipment_skills.json`이다.
    overloadSteps,
    // 적정거리를 가진 무기군. 런처는 인게임에 적정 사거리가 없어 빠진다 —
    // 화면이 체크박스를 그리지 않게 목록을 그대로 내려보낸다
    // (정본: `data/weapon_mechanics.json`의 `optimal_range`).
    optimalRangeWeapons: [...OPTIMAL_RANGE_WEAPONS],
    buffTargetWatch: Object.fromEntries(Object.entries(BUFF_TARGET_WATCH).map(([caster, rows]) => [
      caster, rows.map(([b, l]) => ({ buff: b, label: l })),
    ])),
    // 무기군별 평타 계수 기본값. 값이 없는 무기군은 1.0(보정 없음)으로 채워
    // 브라우저가 무기군 목록만 보고 입력칸을 다 그릴 수 있게 한다.
    normalHitCoeff: Object.fromEntries(WEAPON_TYPES.map((weapon) => [
      weapon, F(pget(pget(mechanics, 'normal_hit_coeff', {}), weapon, 1.0)),
    ])),
    // 탄착군 — 보스 메이커가 사격 원을 그리는 데 쓴다. 지름 D = base − slope × 명중%,
    // 코어 명중 확률 P = (코어반경 / 탄착군반경)^n. 계산기 본체와 **같은 표**를 봐야
    // 화면에 그린 원과 실제 계산이 어긋나지 않는다
    // (정본: `data/weapon_mechanics.json`의 `accuracy`).
    accuracy: {
      modelN: F(pget(accuracy, '_model_n', 2.55)),
      weapons: Object.fromEntries(WEAPON_TYPES.map((weapon) => [weapon, {
        baseDiameter: F(pget(pget(accuracy, weapon, {}), 'base_diameter', 10)),
        accSlope: F(pget(pget(accuracy, weapon, {}), 'acc_slope', 0)),
      }])),
    },
    // 신식 적정거리 — 거리 d에 따라 적정거리 무기군·코어 크기가 바뀌고, 탄착군은 따로 잰 표를 쓴다.
    // 화면(코어 명중률 표시·거리 선택·재생)이 엔진과 같은 값을 보게 그대로 내려보낸다
    // (정본: `data/weapon_mechanics.json`의 `accuracy_distance`·`distance`).
    accuracyDistance: {
      modelN: F(pget(accuracy, '_model_n', 2.55)),
      weapons: Object.fromEntries(WEAPON_TYPES.map((weapon) => {
        const spec = pget(pget(mechanics, 'accuracy_distance', {}), weapon, {});
        const cold = pget(spec, 'cold_diameter', null);
        return [weapon, {
          baseDiameter: F(pget(spec, 'base_diameter', 10)),
          accSlope: F(pget(spec, 'acc_slope', 0)),
          ...(cold == null ? {} : { coldDiameter: F(cold) }),
        }];
      })),
    },
    distance: (() => {
      const table = pget(mechanics, 'distance', {});
      return {
        reference: F(pget(table, 'reference', 30)),
        min: F(pget(table, 'min', 5)),
        max: F(pget(table, 'max', 100)),
        ranges: Object.fromEntries(Object.entries(pget(table, 'ranges', {}) as Record<string, number[]>)
          .filter(([weapon]) => !weapon.startsWith('_')).map(([weapon, [lo, hi]]) => [weapon, [F(lo!), F(hi!)]])),
        presets: Object.fromEntries(Object.entries(pget(table, 'presets', {}) as Record<string, number>)
          .filter(([name]) => !name.startsWith('_')).map(([name, d]) => [name, F(d)])),
      };
    })(),
    consoleClasses: [...CONSOLE_CLASSES],
    consoleCompanies: [...CONSOLE_COMPANIES],
    overloadFields: OVERLOAD_FIELDS,
    manualStats: MANUAL_STATS,
    // 소장품 id → 등급. 블라블라링크는 `favorite_item_lv`를 R·SR에서는 강화 레벨로,
    // SSR(애장품)에서는 단계로 쓰므로 등급을 알아야 그 숫자를 읽을 수 있다.
    // 키가 정수 모양이라 파일 순서를 지키는 `Map`으로 읽는다.
    favoriteItems: loadOrdered(readFileSync(join(ROOT, 'data', 'favorite_items.json'), 'utf-8')),
  };
  return pyDumps(payload, { indent: 2, allowNan: false }) + '\n';
}

runMain(() => {
  process.stdout.write(exportSettings());
});
