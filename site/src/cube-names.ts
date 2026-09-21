/**
 * 하모니 큐브의 «부르는 이름».
 *
 * 데이터의 정식 이름(렐릭 베어 큐브)은 무슨 큐브인지 바로 안 읽힌다 — 사람들은 효과로
 * 부른다(재장 큐브). 남의 덱을 볼 때는 둘 다 필요하다: 정식 이름은 도감과 맞추고,
 * 별명은 한눈에 읽힌다. 「렐릭 베어 큐브 (재장)」처럼 함께 적는다.
 *
 * 별명은 정식 이름으로 찾고, 없으면 효과 스탯으로, 그것도 없으면 별명 없이 정식 이름만.
 * 새 큐브가 데이터에 들어와도 화면이 깨지지 않는다 — 별명만 비어 있을 뿐이다.
 */

/** 정식 이름 → 별명. 정본은 `data/base_stat_tables/cube.json`의 스킬이다. */
export const CUBE_NICKNAMES: Record<string, string> = {
  '렐릭 어설트 큐브': '명중',
  '택티컬 어설트 큐브': '차뎀',
  '렐릭 베어 큐브': '재장',
  '택티컬 베어 큐브': '탄충',
  '렐릭 부스트 큐브': '차속',
  '택티컬 부스트 큐브': '장탄',
  '렐릭 퀀텀 큐브': '버충',
  '렐릭 비고르 큐브': '체력',
  '렐릭 인듀어 큐브': '방어',
  '렐릭 힐링 큐브': '회복',
  '렐릭 템퍼링 큐브': '뎀감',
  // 어시스터는 부르는 이름이 없다(사용자 확인 2026-09-21) — 정식 이름만 적는다.
  '렐릭 어시스터 큐브': '',
  '렐릭 디스트로이 큐브': '파츠',
  '렐릭 피어싱 큐브': '관통',
  '렐릭 크래시 큐브': '방무',
  '렐릭 커버 큐브': '엄폐물',
  '렐릭 디바이드 큐브': '분배',
};

/** 효과 스탯 → 별명. 이름표에 없는 큐브(새로 들어온 것)를 위한 뒷길이다. */
const BY_STAT: Record<string, string> = {
  accuracy_pct: '명중',
  charge_dmg_pct: '차뎀',
  reload_speed_pct: '재장',
  ammo_charge_flat: '탄충',
  charge_speed_pct: '차속',
  max_ammo_pct: '장탄',
  burst_charge_speed_pct: '버충',
  max_hp_pct: '체력',
  def_pct: '방어',
  outgoing_heal_pct: '회복',
  received_dmg_pct: '뎀감',
  part_dmg_pct: '파츠',
  pierce_dmg_pct: '관통',
  armor_break_dmg_pct: '방무',
  cover_hp_pct: '엄폐물',
  split_dmg_pct: '분배',
};

export function cubeNickname(name: string, stat?: string): string {
  // 이름표에 있으면(빈 값이어도) 그것이 답이다 — 어시스터처럼 «별명 없음»이 정답인 큐브가 있다.
  if (name in CUBE_NICKNAMES) return CUBE_NICKNAMES[name]!;
  return (stat ? BY_STAT[stat] : undefined) ?? '';
}

/** 「렐릭 베어 큐브 (재장)」. 별명을 모르면 정식 이름만. */
export function cubeDisplayName(name: string, stat?: string): string {
  const nick = cubeNickname(name, stat);
  return nick ? `${name} (${nick})` : name;
}

/** 「렐릭 베어 큐브 (재장) Lv15」. 안 낀 것(`없음`)은 그대로 «없음». */
export function cubeLine(cube: { name: string; level: number } | undefined, stat?: string): string {
  if (!cube || cube.name === '없음') return '없음';
  return `${cubeDisplayName(cube.name, stat)} Lv${cube.level}`;
}
