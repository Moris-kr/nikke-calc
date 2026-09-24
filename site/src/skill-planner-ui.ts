import type { CharacterMeta, CharacterOverrides } from './types';
import type { StorageLike } from './cache';
import { t, tName } from './i18n';
import {
  calculatePlan, characterCosts, chestPlan, CHEST_EXCHANGE, MANUALS, MATERIAL_NAMES, PLANNER_KEY, readPlannerState,
  UPGRADE_CHEST, UPGRADE_CHEST_NAME,
} from './skill-planner';
import { prependItemIcon } from './item-icons';

interface PlannerOptions {
  catalog: () => CharacterMeta[];
  roster: () => Record<string, CharacterOverrides>;
  storage: () => StorageLike | null | undefined;
  importProfile: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
  const node = document.createElement(tag);
  if (text) node.textContent = t(text);
  if (cls) node.className = cls;
  return node;
};
const button = (label: string, action: () => void) => {
  const node = el('button', label, 'roster-import');
  node.type = 'button'; node.addEventListener('click', action); return node;
};

export function createSkillPlanner(options: PlannerOptions) {
  let state = readPlannerState(null);
  try { state = readPlannerState(options.storage()?.getItem(PLANNER_KEY) ?? null); } catch { /* Storage may be blocked. */ }
  const save = () => { try { options.storage()?.setItem(PLANNER_KEY, JSON.stringify(state)); } catch { /* Session use still works. */ } };
  const targetLevels = (name: string) => ['1', '2', '3'].map((key) =>
    Math.min(10, (characterCosts(name)![key]?.length ?? 0) + 1));
  const levels = (name: string) => {
    const loaded = options.roster()[name]?.skillLevels;
    const costs = characterCosts(name)!;
    return ['1', '2', '3'].map((key) => {
      const value = loaded?.[key as '1' | '2' | '3'];
      return Number.isInteger(value) && value! >= 1 && value! <= (costs[key]?.length ?? 0) + 1 ? value! : 1;
    });
  };

  function render(root: HTMLElement) {
    root.replaceChildren();
    const panel = el('div', undefined, 'skill-planner');
    panel.dataset.skillPlanner = '';
    const header = el('div', undefined, 'skill-planner-header');
    const title = el('div');
    title.append(el('h3', '스킬칩 계산기'), el('p', '여러 니케의 스킬 강화에 필요한 매뉴얼을 한 번에 계산합니다.'));
    header.append(title, button('현재 스킬 레벨 연동', options.importProfile));
    panel.append(header);
    panel.append(el('p', '재료 보유량은 직접 입력합니다. 현재 레벨은 불러온 프로필을 사용하며, 프로필이 없으면 Lv1에서 시작합니다.', 'skill-planner-note'));

    const inventory = el('div', undefined, 'manual-inventory');
    const inputs: HTMLInputElement[] = [];
    for (const id of MANUALS) {
      const card = el('label', undefined, 'manual-card');
      const image = el('img');
      image.src = `${import.meta.env.BASE_URL}manuals/${id}.png`; image.alt = ''; image.width = 76; image.height = 76;
      const input = el('input');
      input.type = 'number'; input.min = '0'; input.max = '9999999'; input.step = '1'; input.inputMode = 'numeric';
      input.value = String(state.inventory[id] ?? 0);
      input.setAttribute('aria-label', t(MATERIAL_NAMES[id]!) + ' ' + t('보유량'));
      input.dataset.manualInventory = id;
      input.addEventListener('input', () => {
        if (input.value === '' || !input.checkValidity()) { update(); return; }
        state.inventory[id] = input.valueAsNumber; save(); update();
      });
      inputs.push(input);
      card.append(image, el('span', MATERIAL_NAMES[id]), el('small', '보유량'), input);
      inventory.append(card);
    }
    panel.append(inventory);
    const actions = el('div', undefined, 'skill-planner-actions');
    const candidates = options.catalog().filter((char) => characterCosts(char.name))
      .sort((a, b) => Number(Boolean(options.roster()[b.name])) - Number(Boolean(options.roster()[a.name])));
    const add = button('캐릭터 추가', () => {
      const char = candidates.find((c) => !state.rows.some((r) => r.name === c.name));
      if (!char) return;
      const current = levels(char.name);
      state.rows.push({ name: char.name, current, target: targetLevels(char.name) }); save(); render(root);
    });
    add.disabled = state.rows.length >= candidates.length;
    actions.append(add, button('프로필 레벨 다시 적용', () => {
      state.rows.forEach((row) => {
        if (!options.roster()[row.name]?.skillLevels) return;
        row.current = levels(row.name);
        row.target = row.target.map((n, i) => Math.max(n, row.current[i]!));
      });
      save(); render(root);
    }));
    panel.append(actions);
    const rows = el('div', undefined, 'skill-plan-rows');
    if (!state.rows.length) rows.append(el('p', '캐릭터를 추가하고 목표 레벨을 선택해 주세요.', 'skill-planner-note'));
    state.rows.forEach((row, index) => {
      const card = el('section', undefined, 'skill-plan-row');
      card.setAttribute('aria-label', row.name);
      const picker = el('div', undefined, 'skill-plan-picker');
      const meta = candidates.find((c) => c.name === row.name);
      if (meta?.image) {
        const image = el('img'); image.src = `${import.meta.env.BASE_URL}${meta.image}`; image.alt = ''; picker.append(image);
      }
      const selection = el('div');
      const search = el('input'); search.type = 'search'; search.placeholder = t('캐릭터 검색'); search.setAttribute('aria-label', t('캐릭터 검색') + ` ${index + 1}`);
      const select = el('select'); select.setAttribute('aria-label', t('캐릭터') + ` ${index + 1}`);
      const fillOptions = () => {
        select.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        for (const char of candidates) {
          if (char.name !== row.name && (state.rows.some((r) => r.name === char.name) || ![char.name, ...char.aliases].some((s) => s.toLocaleLowerCase().includes(query)))) continue;
          const known = options.roster()[char.name]?.skillLevels;
          const option = el('option'); option.value = char.name;
          option.textContent = `${tName(char.name)} · ${known ? levels(char.name).join(' / ') : t('미연동')}`;
          option.selected = char.name === row.name; select.append(option);
        }
      };
      search.addEventListener('input', fillOptions); fillOptions();
      select.addEventListener('change', () => {
        row.name = select.value; row.current = levels(row.name); row.target = targetLevels(row.name); save(); render(root);
      });
      selection.append(search, select, el('small', options.roster()[row.name]?.skillLevels ? '프로필에서 불러온 레벨 · 직접 수정 가능' : '미연동 · 현재 레벨을 확인해 주세요.'));
      picker.append(selection); card.append(picker);
      const skills = el('div', undefined, 'skill-plan-skills');
      ['스킬 1', '스킬 2', '버스트 스킬'].forEach((name, i) => {
        const field = el('div', undefined, 'skill-plan-levels');
        field.append(el('strong', name));
        const max = (characterCosts(row.name)![String(i + 1)]?.length ?? 0) + 1;
        for (const kind of ['current', 'target'] as const) {
          const label = el('label', kind === 'current' ? '현재' : '목표');
          const select = el('select');
          select.setAttribute('aria-label', `${row.name} ${t(name)} ${t(kind === 'current' ? '현재' : '목표')}`);
          for (let level = kind === 'target' ? row.current[i]! : 1; level <= max; level++) {
            const option = el('option', `Lv${level}`); option.value = String(level); option.selected = level === row[kind][i]; select.append(option);
          }
          select.disabled = max === 1;
          select.addEventListener('change', () => {
            row[kind][i] = Number(select.value);
            row.target[i] = Math.max(row.target[i]!, row.current[i]!); save(); render(root);
          });
          label.append(select); field.append(label);
          if (kind === 'current') field.append(el('span', '→'));
        }
        skills.append(field);
      });
      card.append(skills, button('삭제', () => { state.rows.splice(index, 1); save(); render(root); }));
      rows.append(card);
    });
    panel.append(rows);
    const result = el('div', undefined, 'skill-plan-result'); result.setAttribute('aria-live', 'polite');
    panel.append(result);
    panel.append(el('p', '입력한 보유량과 강화 계획은 이 브라우저에 저장됩니다. 실제 보유량이나 딜 계산 설정은 변경하지 않습니다.', 'skill-planner-note'));
    const source = el('a', '소모량 출처: 블라블라링크 공식 니케 데이터'); source.href = 'https://www.blablalink.com'; source.target = '_blank'; source.rel = 'noopener noreferrer'; panel.append(source);
    root.append(panel);
    function update() {
      result.replaceChildren();
      if (inputs.some((input) => input.value === '' || !input.checkValidity())) {
        result.append(el('p', '보유량은 0 이상의 정수로 입력해 주세요.')); return;
      }
      const total = calculatePlan(state.rows, state.inventory);
      result.append(el('h3', '전체 필요량'));
      const wrap = el('div', undefined, 'skill-plan-table-wrap');
      const table = el('table');
      const head = el('thead'); const tr = el('tr');
      ['재료', '필요량', '보유량', '부족량', '남는 수량'].forEach((s) => tr.append(el('th', s))); head.append(tr); table.append(head);
      const body = el('tbody');
      for (const id of MANUALS) {
        const row = el('tr'); row.dataset.materialResult = id;
        const name = el('th', MATERIAL_NAMES[id]);
        prependItemIcon(name, id);
        row.append(name);
        [total.required[id] ?? 0, state.inventory[id] ?? 0, total.shortage[id] ?? 0, total.remaining[id] ?? 0].forEach((n, i) => {
          row.append(el('td', n.toLocaleString(), i === 2 && n > 0 ? 'manual-shortage' : undefined));
        }); body.append(row);
      }
      table.append(body); wrap.append(table); result.append(wrap);
      // 30 DAY 성장 보급 상자 — 부족분을 채우려면 몇 개를 열어 무엇으로 바꿔야 하는지.
      const chest = chestPlan(total.shortage);
      const chestBox = el('section', undefined, 'chest-plan');
      chestBox.dataset.chestPlan = '';
      const chestHead = el('h3');
      chestHead.textContent = chest.total > 0
        ? t('{name} {n}개로 부족분을 채울 수 있습니다', { name: t(UPGRADE_CHEST_NAME), n: chest.total.toLocaleString() })
        : t('부족한 매뉴얼이 없어 {name}를 쓸 필요가 없습니다', { name: t(UPGRADE_CHEST_NAME) });
      prependItemIcon(chestHead, UPGRADE_CHEST, 'chest-icon');
      chestBox.append(chestHead);
      if (chest.rows.length) {
        const list = el('ul', undefined, 'chest-plan-list');
        for (const row of chest.rows) {
          const item = el('li');
          item.dataset.chestRow = row.id;
          item.textContent = t('{item} {per}개로 교환 × {boxes}개 → {gained}개 (부족 {need} · 남음 {surplus})', {
            item: t(MATERIAL_NAMES[row.id]!), per: row.per, boxes: row.boxes.toLocaleString(),
            gained: row.gained.toLocaleString(), need: row.shortage.toLocaleString(), surplus: row.surplus.toLocaleString(),
          });
          prependItemIcon(item, row.id);
          list.append(item);
        }
        chestBox.append(list);
      }
      const rates = el('p', undefined, 'skill-planner-note');
      rates.textContent = t('상자 1개당 하나를 골라 받습니다: {list}', {
        list: MANUALS.map((id) => `${t(MATERIAL_NAMES[id]!)} ${CHEST_EXCHANGE[id]}`).join(' · '),
      });
      chestBox.append(rates);
      result.append(chestBox);
      const codes = Object.entries(total.required).filter(([id]) => !(MANUALS as readonly string[]).includes(id));
      if (codes.length) {
        result.append(el('p', '추가로 필요한 코드 매뉴얼 (보유량 차감 전)', 'skill-planner-note'));
        const list = el('ul', undefined, 'code-manual-list');
        for (const [id, amount] of codes) {
          const item = el('li', `${t(MATERIAL_NAMES[id] ?? id)}: ${amount.toLocaleString()}`);
          item.dataset.codeManual = id;
          prependItemIcon(item, id);
          list.append(item);
        }
        result.append(list);
      }
    }
    update();
  }
  return { render, reset: () => { state = { rows: [], inventory: {} }; save(); } };
}
