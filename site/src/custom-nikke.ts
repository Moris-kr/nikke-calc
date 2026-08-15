import type {
  CharacterMeta,
  CharacterSettingsDefaults,
  CustomCharacter,
  GrowthOption,
} from './types';

export const CUSTOM_KEY = 'nikke-custom-v1';

const WEAPONS = ['AR', 'SMG', 'MG', 'SR', 'RL', 'SG'];
const CODES = ['전격', '작열', '수냉', '풍압', '철갑'];
const CLASSES = ['화력형', '방어형', '지원형'];

// 다른 LLM에 붙여넣을 프롬프트. 우리 엔진이 요구하는 JSON 스키마 + 실제 예시.
export function buildAddPrompt(): string {
  return `너는 모바일 게임 "승리의 여신: 니케"의 캐릭터 데이터를 JSON으로 변환하는 도구다.
아래에 내가 붙여넣을 니케 1명의 이름·스탯·스킬 설명을 읽고, 정확히 아래 스키마의 JSON 객체 하나만 출력해라(코드블록·설명 없이 JSON만).

## nikke(스탯) 필드
공통(모든 무기):
  "rarity": "SSR | SR | R",
  "element_code": "전격 | 작열 | 수냉 | 풍압 | 철갑",
  "class": "화력형 | 방어형 | 지원형",
  "manufacturer": "엘리시온 | 미실리스 | 테트라 | 필그림 | 어브노멀",
  "weapon_type": "AR | SMG | MG | SR | RL | SG",
  "burst_stage": 1 | 2 | 3,
  "burst_cooldown": 초(예: 20, 40),
  "max_ammo": 기본 장탄 수,
  "reload_time": 재장전 초,
  "fire_rate": 초당 발사 수,
  "pellets": 산탄 수(SG만 2 이상, 아니면 1),
  "muzzles": 총구 수(대개 1),
  "damage_coeff": 1발 대미지 계수(%표기 그대로 숫자)
무기 유형별 추가 필드(중요):
  · 연사형(AR·SMG·MG·SG): "core_dmg_mult": 코어 대미지 배율(%, 예 200)
  · 차지형(SR·RL): "charge_time": 풀차지까지 걸리는 초(예 앨리스 1.5, 대부분 RL 1.0),
                   "full_charge_mult": 풀차지 대미지 배율(%, 예 250·350)
    (차지형은 charge_time·full_charge_mult가 반드시 필요하다.)

## skills(스킬 배열) 필드
각 원소:
  "source": "스킬1 | 스킬2 | 버스트스킬",
  "type": "buff | damage",
  "name": "효과 이름",
  "trigger": { "timing": ["발동 시점"], "condition": ["조건(없으면 빈 배열)"] },
  "target": "대상",
  "stat": "효과 종류",
  "polarity": "beneficial | harmful",
  "max_stack": 1,
  "values": { "1": 최저레벨값, "10": 만렙값 }   // 레벨별 값이 있을 때
  // 레벨 무관 고정값이면 "values" 대신 "fixed_value": 숫자
  "duration": 지속초(즉발/영구는 생략 또는 -1)

**엔진은 아래 목록에 없는 stat·timing·target·condition은 무시한다(효과 없음).**
확실하지 않으면 가장 가까운 표준값을 쓰고, 못 맞추겠으면 그 효과는 빼라.

timing: full_burst_start, burst_cast, last_bullet, last_bullet_fire, full_charge_hit, battle_start, passive, hit_count:N
target: self, all_allies, target, same_target, all_enemies, allies_code:<속성>, allies_weapon:<무기>, enemies_top_atk:N
buff stat: atk_pct, atk_flat, atk_dmg_pct, crit_rate, crit_dmg, core_dmg_pct, element_bonus_pct, max_ammo_pct, max_ammo_flat, reload_speed_pct, charge_speed_pct, charge_dmg_pct, received_dmg_pct, def_ignore_pct, accuracy_pct, normal_atk_dmg_pct
damage stat: bonus_damage, burst_damage, damage (type이 "damage"일 때, values는 대미지 계수)

## 참고 예시
연사형(프리바티, AR):
{"name":"프리바티","nikke":{"rarity":"SSR","element_code":"수냉","class":"화력형","manufacturer":"테트라","weapon_type":"AR","burst_stage":3,"burst_cooldown":40,"max_ammo":60,"reload_time":1.0,"fire_rate":12.0,"pellets":1,"muzzles":1,"damage_coeff":13.65,"core_dmg_mult":200.0},"skills":[
{"source":"스킬1","type":"buff","name":"EX 매거진","trigger":{"timing":["full_burst_start"],"condition":[]},"target":"all_allies","stat":"atk_pct","polarity":"beneficial","max_stack":1,"values":{"1":18.77,"10":23.61},"duration":10.0},
{"source":"버스트스킬","type":"damage","name":"AK 미사일","trigger":{"timing":["burst_cast"],"condition":[]},"target":"all_enemies","stat":"burst_damage","values":{"1":831.79,"10":1407.64}}
]}
차지형(앨리스, SR):
{"name":"앨리스 예시","nikke":{"rarity":"SSR","element_code":"작열","class":"화력형","manufacturer":"테트라","weapon_type":"SR","burst_stage":3,"burst_cooldown":40,"max_ammo":6,"reload_time":2.0,"fire_rate":1.0,"pellets":1,"muzzles":1,"damage_coeff":41.36,"charge_time":1.5,"full_charge_mult":350.0},"skills":[
{"source":"버스트스킬","type":"buff","name":"공격 버프","trigger":{"timing":["burst_cast"],"condition":[]},"target":"self","stat":"atk_pct","polarity":"beneficial","max_stack":1,"values":{"1":50.0,"10":90.0},"duration":10.0}
]}

이제 아래 니케를 변환해라. 확실하지 않은 값은 합리적으로 추정하되 스키마는 반드시 지켜라:

[여기에 니케 이름과 스킬 설명을 붙여넣으세요]`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 붙여넣은 JSON을 검증해 CustomCharacter로. 실패하면 사람이 읽을 오류를 던진다. */
export function parseCustomInput(text: string): CustomCharacter {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error('JSON 형식이 아닙니다. LLM이 준 JSON만 붙여넣어 주세요.');
  }
  if (!isRecord(data)) throw new Error('최상위는 객체여야 합니다.');
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new Error('name(이름)이 필요합니다.');
  if (!isRecord(data.nikke)) throw new Error('nikke(스탯) 객체가 필요합니다.');
  if (!Array.isArray(data.skills)) throw new Error('skills(스킬 배열)가 필요합니다.');

  const nikke = data.nikke;
  const required = ['rarity', 'element_code', 'class', 'weapon_type', 'burst_stage',
    'burst_cooldown', 'max_ammo', 'reload_time', 'fire_rate', 'damage_coeff'];
  const missing = required.filter((f) => nikke[f] === undefined || nikke[f] === null);
  if (missing.length > 0) throw new Error(`nikke에 누락된 항목: ${missing.join(', ')}`);
  if (!WEAPONS.includes(String(nikke.weapon_type))) {
    throw new Error(`weapon_type은 ${WEAPONS.join('/')} 중 하나여야 합니다.`);
  }
  if (!CODES.includes(String(nikke.element_code))) {
    throw new Error(`element_code는 ${CODES.join('/')} 중 하나여야 합니다.`);
  }
  if (!CLASSES.includes(String(nikke.class))) {
    throw new Error(`class는 ${CLASSES.join('/')} 중 하나여야 합니다.`);
  }
  if (![1, 2, 3].includes(Number(nikke.burst_stage))) {
    throw new Error('burst_stage는 1, 2, 3 중 하나여야 합니다.');
  }

  // 엔진 기본값 보정 (누락 허용 필드)
  const filled: Record<string, unknown> = {
    pellets: 1, muzzles: 1, core_dmg_mult: 100.0, squad: '', squad_name: '',
    ...nikke,
    burst_stage: Number(nikke.burst_stage),
    manufacturer: typeof nikke.manufacturer === 'string' ? nikke.manufacturer : '',
  };
  // 차지형(SR·RL)은 charge_time(풀차지까지 초)·full_charge_mult(풀차지 대미지 %)를
  // 엔진이 직접 읽는다. 누락 시 크래시 대신 합리적 기본값으로 채운다.
  if (nikke.weapon_type === 'SR' || nikke.weapon_type === 'RL') {
    if (filled.charge_time === undefined) filled.charge_time = 1.0;
    if (filled.full_charge_mult === undefined) filled.full_charge_mult = 250.0;
  }
  return { name, nikke: filled, skills: data.skills };
}

const growthOptionsFor = (rarity: string): { options: GrowthOption[]; max: number; def: number } => {
  const label = (v: number): string =>
    v === 0 ? '명함' : v <= 3 ? `${v}돌` : `코강 ${v - 3}`;
  const affinity = (v: number): number => (v === 0 ? 10 : v === 1 ? 20 : 30);
  if (rarity === 'R') {
    return { options: [{ value: 0, label: '명함', affinity: 10 }], max: 0, def: 0 };
  }
  const max = rarity === 'SR' ? 2 : 10;
  const options = Array.from({ length: max + 1 }, (_, v) => ({ value: v, label: label(v), affinity: affinity(v) }));
  return { options, max, def: rarity === 'SR' ? 2 : 3 };
};

export function customToMeta(custom: CustomCharacter): CharacterMeta {
  const n = custom.nikke;
  return {
    name: custom.name,
    burstStage: String(n.burst_stage ?? ''),
    elementCode: String(n.element_code ?? ''),
    weaponType: String(n.weapon_type ?? ''),
    className: String(n.class ?? ''),
    manufacturer: String(n.manufacturer ?? ''),
    preview: false,
    image: null,
  };
}

export function customToSettings(custom: CustomCharacter): CharacterSettingsDefaults {
  const rarity = String(custom.nikke.rarity ?? 'SSR');
  const growth = growthOptionsFor(rarity);
  return {
    weaponType: String(custom.nikke.weapon_type ?? ''),
    recommendedControl: {},
    hasConditionalControl: false,
    growthStage: growth.def,
    rarity,
    maxGrowthStage: growth.max,
    growthOptions: growth.options,
    skillLevels: { '1': 10, '2': 10, '3': 10 },
    skillLevelsLocked: false,
    overload: {
      element_bonus: 88.6, atk_pct: 22.22, def_pct: 0, max_ammo_pct: 129.64,
      crit_rate: 0, crit_dmg: 0, charge_speed_pct: 0, charge_dmg_pct: 0, accuracy_pct: 0,
    },
    cube: { name: '재장', level: 15 },
  };
}

export function loadCustom(getItem: (key: string) => string | null): Record<string, CustomCharacter> {
  try {
    const raw = getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CustomCharacter>) : {};
  } catch {
    return {};
  }
}
