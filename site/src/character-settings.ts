import type {
  CharacterOverrides,
  CubeName,
  SettingsCatalog,
  SkillLevels,
} from './types';

const cubeNames: CubeName[] = ['재장', '탄충', '체력', '차속', '파츠'];
const skillLabels: Array<[keyof SkillLevels, string]> = [
  ['1', '스킬 1'],
  ['2', '스킬 2'],
  ['3', '버스트'],
];

const numberText = (value: number, digits = 2): string => value.toFixed(digits);

const cloneOverrides = (value: CharacterOverrides): CharacterOverrides => ({
  ...(value.skillLevels ? { skillLevels: { ...value.skillLevels } } : {}),
  ...(value.overload ? { overload: { ...value.overload } } : {}),
  ...(value.cube ? { cube: { ...value.cube } } : {}),
  ...(value.manualStats ? { manualStats: { ...value.manualStats } } : {}),
});

export function defaultCharacterOverrides(
  name: string,
  catalog: SettingsCatalog,
): CharacterOverrides {
  const defaults = catalog.characters[name];
  if (!defaults) throw new Error(`${name}: 기본 장비 설정을 찾을 수 없습니다.`);
  return {
    skillLevels: { ...defaults.skillLevels },
    overload: { ...defaults.overload },
    cube: { ...defaults.cube },
    manualStats: {},
  };
}

function makeInputUnit(input: HTMLInputElement, unit: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'input-unit';
  wrap.append(input);
  if (unit) {
    const suffix = document.createElement('em');
    suffix.textContent = unit;
    wrap.append(suffix);
  }
  return wrap;
}

function summaryText(name: string, catalog: SettingsCatalog, value?: CharacterOverrides): string {
  const defaults = catalog.characters[name];
  if (!defaults) return '설정 정보 없음';
  const skillLevels = value?.skillLevels ?? defaults.skillLevels;
  const overload = value?.overload ?? defaults.overload;
  const cube = value?.cube ?? defaults.cube;
  const skillSummary = defaults.skillLevelsLocked
    ? '수치 미공개 · Lv10 고정'
    : `스킬 ${skillLevels['1']} / ${skillLevels['2']} / ${skillLevels['3']}`;
  return `${value ? '개별값' : '기본값'} · ${skillSummary} · 우코 ${numberText(overload.element_bonus ?? 0)} · `
    + `공증 ${numberText(overload.atk_pct ?? 0)} · 장탄 ${numberText(overload.max_ammo_pct ?? 0)} · `
    + `${cube.name} Lv${cube.level}`;
}

export function renderCharacterSettings(
  container: HTMLElement,
  name: string,
  catalog: SettingsCatalog,
  value: CharacterOverrides | undefined,
  onChange: (next: CharacterOverrides | undefined) => void,
): void {
  const advancedWasOpen = container.querySelector<HTMLInputElement>('[data-advanced-toggle]')?.checked ?? false;
  container.replaceChildren();
  container.className = 'character-settings';

  const commit = (next: CharacterOverrides | undefined) => {
    onChange(next);
    renderCharacterSettings(container, name, catalog, next, onChange);
  };

  const summary = document.createElement('p');
  summary.className = 'loadout-summary';
  summary.dataset.loadoutSummary = '';
  summary.textContent = summaryText(name, catalog, value);
  container.append(summary);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'inline-check';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = Boolean(value);
  toggle.dataset.customToggle = '';
  const toggleText = document.createElement('span');
  toggleText.textContent = '개별 설정';
  toggleLabel.append(toggle, toggleText);
  container.append(toggleLabel);
  toggle.addEventListener('change', () => {
    commit(toggle.checked ? defaultCharacterOverrides(name, catalog) : undefined);
  });

  if (!value) return;
  let current = cloneOverrides(value);
  const defaults = catalog.characters[name];
  if (!defaults) return;
  current.skillLevels ??= { ...defaults.skillLevels };
  current.overload ??= { ...defaults.overload };
  current.cube ??= { ...defaults.cube };
  current.manualStats ??= {};
  const emitNumericChange = (next: CharacterOverrides) => {
    current = cloneOverrides(next);
    onChange(current);
    summary.textContent = summaryText(name, catalog, current);
  };

  const body = document.createElement('div');
  body.className = 'character-settings-body';
  body.dataset.characterSettingsBody = '';

  const skillEditor = document.createElement('section');
  skillEditor.className = 'skill-level-editor';
  const skillHeading = document.createElement('h4');
  skillHeading.textContent = '스킬 레벨';
  skillEditor.append(skillHeading);
  if (defaults.skillLevelsLocked) {
    skillEditor.classList.add('is-locked');
    skillEditor.dataset.skillLevelsLocked = '';
    const locked = document.createElement('strong');
    locked.textContent = '수치 미공개 · Lv10 고정';
    const explanation = document.createElement('p');
    explanation.textContent = '1~9레벨 계수가 공개되지 않아 Lv10 기준으로만 계산합니다.';
    skillEditor.append(locked, explanation);
  } else {
    const skillControls = document.createElement('div');
    skillControls.className = 'skill-level-controls';
    for (const [key, labelText] of skillLabels) {
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = labelText;
      const select = document.createElement('select');
      select.dataset.skillLevel = key;
      for (let level = 1; level <= 10; level += 1) {
        const option = document.createElement('option');
        option.value = String(level);
        option.textContent = `Lv${level}`;
        select.append(option);
      }
      select.value = String(current.skillLevels[key]);
      select.addEventListener('change', () => {
        const next = cloneOverrides(current);
        next.skillLevels![key] = Number(select.value);
        emitNumericChange(next);
      });
      label.append(text, select);
      skillControls.append(label);
    }
    skillEditor.append(skillControls);
  }
  body.append(skillEditor);

  const overloadGrid = document.createElement('div');
  overloadGrid.className = 'overload-grid';
  for (const [key, meta] of Object.entries(catalog.overloadFields)) {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = meta.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.value = String(current.overload[key] ?? defaults.overload[key] ?? 0);
    input.dataset.overloadKey = key;
    input.addEventListener('input', () => {
      const next = cloneOverrides(current);
      next.overload![key] = Number(input.value);
      emitNumericChange(next);
    });
    label.append(text, makeInputUnit(input, meta.unit));
    overloadGrid.append(label);
  }
  body.append(overloadGrid);

  const cubeBox = document.createElement('section');
  cubeBox.className = 'cube-editor';
  const cubeHeading = document.createElement('h4');
  cubeHeading.textContent = '하모니 큐브';
  const cubeControls = document.createElement('div');
  cubeControls.className = 'cube-controls';
  const cubeSelect = document.createElement('select');
  cubeSelect.dataset.cubeName = '';
  for (const cubeName of cubeNames) {
    const option = document.createElement('option');
    option.value = cubeName;
    option.textContent = cubeName;
    cubeSelect.append(option);
  }
  cubeSelect.value = current.cube.name;
  const levelSelect = document.createElement('select');
  levelSelect.dataset.cubeLevel = '';
  const availableLevels = Object.keys(catalog.cubes[current.cube.name].levels)
    .map(Number).sort((left, right) => left - right);
  for (const level of availableLevels) {
    const option = document.createElement('option');
    option.value = String(level);
    option.textContent = `Lv${level}`;
    levelSelect.append(option);
  }
  levelSelect.value = String(current.cube.level);
  cubeSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    next.cube = { name: cubeSelect.value as CubeName, level: current.cube!.level };
    if (!catalog.cubes[next.cube.name].levels[String(next.cube.level)]) {
      next.cube.level = 15;
    }
    commit(next);
  });
  levelSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    next.cube = { name: current.cube!.name, level: Number(levelSelect.value) };
    commit(next);
  });
  cubeControls.append(cubeSelect, levelSelect);
  const level = catalog.cubes[current.cube.name].levels[String(current.cube.level)];
  const cubeSummary = document.createElement('p');
  cubeSummary.className = 'cube-summary';
  if (level) {
    const effect = catalog.cubes[current.cube.name].template.replace('{0}', String(level.effect));
    cubeSummary.textContent = `공격 ${level.atk.toLocaleString('en-US')} · 방어 ${level.def.toLocaleString('en-US')} · `
      + `체력 ${level.hp.toLocaleString('en-US')} · ${effect} · 우월 코드 ${level.commonElement}%`;
  }
  cubeBox.append(cubeHeading, cubeControls, cubeSummary);
  body.append(cubeBox);

  const advancedLabel = document.createElement('label');
  advancedLabel.className = 'inline-check advanced-toggle';
  const advancedToggle = document.createElement('input');
  advancedToggle.type = 'checkbox';
  advancedToggle.checked = advancedWasOpen;
  advancedToggle.dataset.advancedToggle = '';
  const advancedText = document.createElement('span');
  advancedText.textContent = '고급 모드';
  advancedLabel.append(advancedToggle, advancedText);
  body.append(advancedLabel);

  const advanced = document.createElement('div');
  advanced.className = 'advanced-editor';
  advanced.hidden = !advancedToggle.checked;
  const picker = document.createElement('div');
  picker.className = 'advanced-picker';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '추가 수치 검색';
  search.dataset.manualSearch = '';
  const manualSelect = document.createElement('select');
  manualSelect.dataset.manualSelect = '';
  const add = document.createElement('button');
  add.type = 'button';
  add.dataset.addStat = '';
  add.textContent = '수치 추가';
  const renderManualOptions = () => {
    const query = search.value.trim().toLocaleLowerCase('ko');
    manualSelect.replaceChildren();
    for (const [key, meta] of Object.entries(catalog.manualStats)) {
      if (key in current.manualStats!) continue;
      if (query && !meta.label.toLocaleLowerCase('ko').includes(query) && !key.includes(query)) continue;
      const option = document.createElement('option');
      option.value = key;
      option.textContent = meta.label;
      manualSelect.append(option);
    }
    add.disabled = manualSelect.options.length === 0;
  };
  search.addEventListener('input', renderManualOptions);
  add.addEventListener('click', () => {
    const key = manualSelect.value;
    if (!key || key in current.manualStats!) return;
    const next = cloneOverrides(current);
    next.manualStats![key] = 0;
    commit(next);
  });
  renderManualOptions();
  picker.append(search, manualSelect, add);
  advanced.append(picker);

  const rows = document.createElement('div');
  rows.className = 'manual-rows';
  for (const [key, manualValue] of Object.entries(current.manualStats)) {
    const meta = catalog.manualStats[key];
    if (!meta) continue;
    const row = document.createElement('label');
    row.className = 'manual-row';
    row.dataset.manualRow = key;
    const text = document.createElement('span');
    text.textContent = meta.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.value = String(manualValue);
    input.dataset.manualStat = key;
    input.addEventListener('input', () => {
      const next = cloneOverrides(current);
      next.manualStats![key] = Number(input.value);
      emitNumericChange(next);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeStat = key;
    remove.textContent = '삭제';
    remove.addEventListener('click', () => {
      const next = cloneOverrides(current);
      delete next.manualStats![key];
      commit(next);
    });
    row.append(text, makeInputUnit(input, meta.unit), remove);
    rows.append(row);
  }
  advanced.append(rows);
  advancedToggle.addEventListener('change', () => {
    advanced.hidden = !advancedToggle.checked;
  });
  body.append(advanced);
  container.append(body);
}
