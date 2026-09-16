import type { CharacterMeta, SkillLevels } from './types';

export interface InfoSkill {
  key: keyof SkillLevels;
  name: string;
  template: string;
  values: Record<string, Array<string | number>>;
  cooldown?: string | null;
}
export interface CharacterInfo {
  squad?: string;
  weapon?: string;
  skills: InfoSkill[];
  favorite?: { name: string; skills: Array<InfoSkill & { stage: number }> };
}
export function skillsForFavorite(info: CharacterInfo, stage: number): InfoSkill[] {
  const skills = info.skills.map(skill => ({ ...skill }));
  for (const variant of [...(info.favorite?.skills ?? [])].sort((a,b) => a.stage - b.stage)) {
    const index = skills.findIndex(skill => skill.key === variant.key);
    if (variant.stage <= stage && index >= 0) skills[index] = { ...skills[index]!, ...variant };
  }
  return skills;
}
export function skillDescription(skill: InfoSkill, level: number): string {
  const values = skill.values[String(level)];
  if (!values) return '이 레벨의 스킬 설명 데이터가 없습니다.';
  return skill.template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? '미확인'));
}

/** 직접 등록한 효과는 원문이 없으므로 계산에 쓰는 효과를 설명한다. */
export function customSkillInfo(effects: unknown[], nikke?: Record<string, unknown>): CharacterInfo {
  const labels: Record<string, string> = { atk_pct: '공격력 증가 (%)', charge_dmg_pct: '차지 대미지 증가 (%)', burst_damage: '버스트 대미지 (%)', bonus_damage: '추가 대미지 (%)', charge_speed_pct: '차지 속도 증가 (%)', atk_dmg_pct: '공격 대미지 증가 (%)' };
  const timing: Record<string, string> = { full_burst_start: '풀 버스트 시작 시', burst_cast: '버스트 사용 시', passive: '상시', battle_start: '전투 시작 시', full_charge_hit: '풀 차지 명중 시' };
  const targets: Record<string, string> = { self: '자신', target: '대상', all_allies: '아군 전체', all_enemies: '적 전체' };
  const skills: InfoSkill[] = [];
  for (const key of ['1', '2', '3'] as const) {
    const source = key === '3' ? '버스트스킬' : `스킬${key}`;
    const rows = effects.filter((e): e is Record<string, any> => !!e && typeof e === 'object' && ((e as Record<string, unknown>).source === source || (key === '3' && (e as Record<string, unknown>).source === '스킬3')));
    if (!rows.length) continue;
    const values: InfoSkill['values'] = {};
    for (let level = 1; level <= 10; level++) {
      if (rows.every(row => row.fixed_value !== undefined || row.values?.[String(level)] !== undefined)) {
        values[String(level)] = rows.map(row => row.fixed_value ?? row.values[String(level)]);
      }
    }
    skills.push({ key, cooldown: key === '3' && nikke?.burst_cooldown != null ? `${nikke.burst_cooldown}초` : undefined, name: [...new Set(rows.map(row => String(row.name ?? source)))].join(' / '), values,
      template: rows.map((row, index) => `${(row.trigger?.timing ?? []).map((v: string) => timing[v] ?? v).join(', ')} · ${targets[String(row.target)] ?? row.target}\n${labels[String(row.stat)] ?? row.stat}: {${index}}${Number(row.duration) > 0 ? ` · ${row.duration}초 유지` : ''}`).join('\n\n') });
  }
  return { skills, squad: nikke?.squad_name ? String(nikke.squad_name) : undefined };
}

export function openCharacterInfo(options: {
  host: HTMLElement; char: CharacterMeta; info?: CharacterInfo; rarity?: string;
  levels: SkillLevels; locked: boolean; inDeck: boolean; favorite?: number; fictional?: boolean;
  onChange: (levels: SkillLevels) => void; onClose: () => void;
}): void {
  const { host, char, info, locked } = options;
  host.querySelector<HTMLDialogElement>('.character-info-dialog')?.close();
  const dialog = document.createElement('dialog');
  dialog.className = 'character-info-dialog';
  dialog.ariaLabel = `${char.name} 정보`;
  const add = (tag: string, text: string, parent: HTMLElement = dialog, className = '') => {
    const node = document.createElement(tag); node.textContent = text; node.className = className; parent.append(node); return node;
  };
  const head = add('header', '', dialog, 'character-info-header');
  add('h2', char.name, head);
  const close = add('button', '닫기', head) as HTMLButtonElement;
  close.type = 'button'; close.autofocus = true; close.addEventListener('click', () => dialog.close());
  add('p', [options.rarity, char.manufacturer, char.className, char.elementCode, char.weaponType, `버스트 ${char.burstStage}`, info?.squad].filter(Boolean).join(' · '), dialog, 'character-info-meta');
  if (char.preview) add('p', options.fictional ? '[임시 · 창작] 공개되지 않은 스킬은 창작 값이며 실제 성능과 다릅니다.' : '[프리뷰 · 미검증] 출시 전 정보이며 실제 성능은 검증되지 않았습니다.', dialog, 'character-info-warning');
  add('p', locked ? '레벨 10 데이터만 제공되어 스킬 레벨은 10으로 고정됩니다.' : options.inDeck ? '레벨 변경은 현재 덱 설정에 반영됩니다. 결과를 갱신하려면 다시 계산하세요.' : '레벨을 바꾸며 설명을 확인할 수 있습니다. 편성 설정에는 반영하지 않습니다.', dialog, 'character-info-help');
  if (info?.weapon) { add('h3', '무기'); add('p', info.weapon, dialog, 'character-info-description'); }
  if (info?.favorite) add('p', `${info.favorite.name} · ${(options.favorite ?? 0) > 0 ? `애장품 ${options.favorite}단계 스킬` : '애장품 미적용 · 기본 스킬'}`, dialog, 'character-info-help');
  const levels = { ...options.levels };
  for (const skill of info ? skillsForFavorite(info, options.favorite ?? 0) : []) {
    const section = add('section', '', dialog, 'character-info-skill');
    add('h3', `${skill.key === '3' ? '버스트 스킬' : `스킬 ${skill.key}`} · ${skill.name}`, section);
    if (skill.cooldown) add('p', `쿨타임 ${skill.cooldown}`, section, 'character-info-help');
    const label = add('label', '스킬 레벨 ', section);
    const select = document.createElement('select');
    select.ariaLabel = `${skill.name} 레벨`; select.dataset.infoSkill = skill.key;
    const available = Object.keys(skill.values).map(Number).filter(v => Number.isInteger(v) && v >= 1 && v <= 10).sort((a,b) => a-b);
    for (const level of available) { const option = document.createElement('option'); option.value = String(level); option.textContent = `Lv. ${level}`; select.append(option); }
    const initial = locked ? 10 : levels[skill.key];
    select.value = String(available.includes(initial) ? initial : available.at(-1) ?? 10);
    select.disabled = locked || available.length < 2;
    label.append(select);
    const description = add('p', skillDescription(skill, Number(select.value)), section, 'character-info-description');
    select.addEventListener('change', () => {
      levels[skill.key] = Number(select.value);
      description.textContent = skillDescription(skill, levels[skill.key]);
      if (options.inDeck) options.onChange({ ...levels });
    });
  }
  if (!info?.skills.length) add('p', '등록된 스킬 설명이 없습니다.');
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { dialog.remove(); options.onClose(); }, { once: true });
  host.append(dialog); dialog.showModal();
}
