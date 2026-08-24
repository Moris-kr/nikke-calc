import type {
  CharacterControl,
  CharacterOverrides,
  CubeName,
  EquipPart,
  EquipSetting,
  SettingsCatalog,
  SkillLevels,
} from './types';

// 톡톡이를 직접 켤 때 채워지는 발사 속도(발/초) — 44톡톡이. 유저 지정값이다.
// 220ms(≈4.5발/초)는 게임이 강제하는 하한이라 그 위는 사람이 낼 수 없다
// (`context/CONTROL.md` §톡톡이).
//
// 참고: 엔진의 캐릭터별 «추천 자동» 컨트롤은 `data/char_defaults.json`에서 3.6을 쓰고
// CONTROL.md는 실질 범위를 3.0~4.2로 적는다. 여기는 직접 켤 때의 출발값이라 별개다.
const TAP_FIRE_DEFAULT = 4.4;
const TAP_FIRE_HARD_LIMIT = 4.5;
const WEAPON_MODE_SWAP_DEFAULT = 6;

const EQUIP_PARTS: EquipPart[] = ['머리', '몸통', '팔', '다리'];
// 내부 부위 키는 '팔'이지만 UI·CSV 표기는 '장갑'이다.
const EQUIP_PART_LABELS: Record<EquipPart, string> = {
  머리: '머리', 몸통: '몸통', 팔: '장갑', 다리: '다리',
};

const skillLabels: Array<[keyof SkillLevels, string]> = [
  ['1', '스킬 1'],
  ['2', '스킬 2'],
  ['3', '버스트'],
];

const numberText = (value: number, digits = 2): string => value.toFixed(digits);

const cloneOverrides = (value: CharacterOverrides): CharacterOverrides => ({
  ...(value.growthStage !== undefined ? { growthStage: value.growthStage } : {}),
  ...(value.skillLevels ? { skillLevels: { ...value.skillLevels } } : {}),
  ...(value.overload ? { overload: { ...value.overload } } : {}),
  ...(value.cube ? { cube: { ...value.cube } } : {}),
  ...(value.collection ? { collection: { ...value.collection } } : {}),
  ...(value.control !== undefined ? {
    control: Object.fromEntries(
      Object.entries(value.control).map(([key, entry]) => [key, { ...entry }]),
    ) as CharacterControl,
  } : {}),
  ...(value.manualStats ? { manualStats: { ...value.manualStats } } : {}),
  ...(value.burst ? { burst: value.burst } : {}),
  ...(value.equipLevels ? { equipLevels: { ...value.equipLevels } } : {}),
  ...(value.weaponModeSwapAt !== undefined ? { weaponModeSwapAt: value.weaponModeSwapAt } : {}),
});

export function defaultCharacterOverrides(
  name: string,
  catalog: SettingsCatalog,
): CharacterOverrides {
  const defaults = catalog.characters[name];
  if (!defaults) throw new Error(`${name}: 기본 장비 설정을 찾을 수 없습니다.`);
  return {
    growthStage: defaults.growthStage,
    skillLevels: { ...defaults.skillLevels },
    overload: { ...defaults.overload },
    cube: { ...defaults.cube },
    collection: { ...defaults.collection },
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
  const growthStage = value?.growthStage ?? defaults.growthStage;
  const controlSummary = value?.control === undefined
    ? '컨트롤 추천 자동'
    : `컨트롤 직접 ${Object.keys(value.control).length}개`;
  const growth = defaults.growthOptions.find((option) => option.value === growthStage)
    ?? { value: growthStage, label: `단계 ${growthStage}`, affinity: 0 };
  const skillSummary = defaults.skillLevelsLocked
    ? '수치 미공개 · Lv10 고정'
    : `스킬 ${skillLevels['1']} / ${skillLevels['2']} / ${skillLevels['3']}`;
  return `${value ? '개별값' : '기본값'} · ${growth.label} · 호감도 ${growth.affinity} · ${skillSummary} · `
    + `우코 ${numberText(overload.element_bonus ?? 0)} · `
    + `공증 ${numberText(overload.atk_pct ?? 0)} · 장탄 ${numberText(overload.max_ammo_pct ?? 0)} · `
    + `${cube.name} Lv${cube.level} · ${controlSummary}`;
}

export function renderCharacterSettings(
  container: HTMLElement,
  name: string,
  catalog: SettingsCatalog,
  value: CharacterOverrides | undefined,
  onChange: (next: CharacterOverrides | undefined) => void,
): void {
  const advancedWasOpen = container.querySelector<HTMLInputElement>('[data-advanced-toggle]')?.checked ?? false;
  // 펼침 상태는 다시 그려도 유지한다. 값을 하나 바꿀 때마다 접히면 쓸 수 없다.
  // 기본값은 **접힘**이다 — 카드 다섯 장이 한 화면에 서니, 켜 두기만 한 설정까지
  // 늘 펼쳐져 있으면 편성 자체가 안 보인다.
  const wasOpen = (flag: string): boolean =>
    container.querySelector<HTMLElement>(`[${flag}]`)?.getAttribute('aria-expanded') === 'true';
  const bodyWasOpen = wasOpen('data-settings-open');
  const controlWasOpen = wasOpen('data-control-open');

  /** 눌러서 펼치는 머리. 접힌 채로 시작하고, 무엇이 들었는지 이름으로 알린다. */
  const disclosure = (label: string, flag: string, open: boolean) => {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'disclosure';
    head.setAttribute(flag, '');
    head.setAttribute('aria-expanded', String(open));
    const title = document.createElement('span');
    title.className = 'disclosure-label';
    title.textContent = label;
    const hint = document.createElement('span');
    hint.className = 'disclosure-hint';
    hint.textContent = open ? '접기' : '펼치기';
    head.append(title, hint);
    const panel = document.createElement('div');
    panel.className = 'disclosure-panel';
    panel.hidden = !open;
    head.addEventListener('click', () => {
      const next = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(next));
      panel.hidden = !next;
      const hint = head.querySelector('.disclosure-hint');
      if (hint) hint.textContent = next ? '접기' : '펼치기';
    });
    return { head, panel };
  };
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
  current.growthStage ??= defaults.growthStage;
  current.skillLevels ??= { ...defaults.skillLevels };
  current.overload ??= { ...defaults.overload };
  current.cube ??= { ...defaults.cube };
  current.collection ??= { ...defaults.collection };
  current.manualStats ??= {};
  const emitNumericChange = (next: CharacterOverrides) => {
    current = cloneOverrides(next);
    onChange(current);
    summary.textContent = summaryText(name, catalog, current);
  };

  const body = document.createElement('div');
  body.className = 'character-settings-body';
  body.dataset.characterSettingsBody = '';

  const growthEditor = document.createElement('section');
  growthEditor.className = 'growth-editor';
  const growthHeading = document.createElement('h4');
  growthHeading.textContent = `돌파 · 코어 강화 (${defaults.rarity})`;
  const growthSelect = document.createElement('select');
  growthSelect.dataset.growthStage = '';
  for (const growth of defaults.growthOptions) {
    const option = document.createElement('option');
    option.value = String(growth.value);
    option.textContent = growth.label;
    growthSelect.append(option);
  }
  growthSelect.value = String(current.growthStage);
  growthSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    next.growthStage = Number(growthSelect.value);
    commit(next);
  });
  const growthNote = document.createElement('p');
  growthNote.textContent = '호감도는 돌파별 최대치로 적용합니다.';
  growthEditor.append(growthHeading, growthSelect, growthNote);
  body.append(growthEditor);

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

  const burstEditor = document.createElement('section');
  burstEditor.className = 'burst-editor';
  const burstHeading = document.createElement('h4');
  burstHeading.textContent = '버스트 운용';
  const burstMode = current.burst?.mode ?? 'auto';
  const burstEvery = current.burst?.mode === 'priority' ? current.burst.every : 1;

  const burstRow = document.createElement('div');
  burstRow.className = 'burst-row';
  const burstSelect = document.createElement('select');
  burstSelect.dataset.burstAssignment = '';
  for (const [optionValue, optionLabel] of [
    ['auto', '자동'], ['priority', 'n의 배수 우선 사용'], ['skip', '가급적 안 씀'],
  ] as Array<[string, string]>) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    burstSelect.append(option);
  }
  burstSelect.value = burstMode;

  const everyWrap = document.createElement('label');
  everyWrap.className = 'burst-every';
  everyWrap.hidden = burstMode !== 'priority';
  const everyInput = document.createElement('input');
  everyInput.type = 'number';
  everyInput.min = '1';
  everyInput.step = '1';
  everyInput.value = String(burstEvery);
  everyInput.dataset.burstEvery = '';
  const everyText = document.createElement('span');
  everyText.textContent = '의 배수 사이클마다';
  everyWrap.append(everyInput, everyText);
  burstRow.append(burstSelect, everyWrap);

  const applyBurst = () => {
    const next = cloneOverrides(current);
    const mode = burstSelect.value;
    if (mode === 'priority') {
      const n = Math.max(1, Math.trunc(Number(everyInput.value) || 1));
      next.burst = { mode: 'priority', every: n };
    } else if (mode === 'skip') {
      next.burst = { mode: 'skip' };
    } else {
      delete next.burst;
    }
    emitNumericChange(next);
  };
  burstSelect.addEventListener('change', () => {
    everyWrap.hidden = burstSelect.value !== 'priority';
    applyBurst();
  });
  everyInput.addEventListener('input', applyBurst);

  const burstNote = document.createElement('p');
  burstNote.className = 'field-note';
  burstNote.textContent =
    '같은 버스트 단계 후보가 여럿일 때, n의 배수 사이클마다 이 캐릭터를 우선 사용합니다(쿨타임 한도 내). n=1이면 매 사이클.';
  burstEditor.append(burstHeading, burstRow, burstNote);
  body.append(burstEditor);

  const equipEditor = document.createElement('section');
  equipEditor.className = 'equip-editor';
  const equipHeading = document.createElement('h4');
  equipHeading.textContent = '장비 레벨';
  const equipGrid = document.createElement('div');
  equipGrid.className = 'equip-grid';
  for (const part of EQUIP_PARTS) {
    const partLabel = document.createElement('label');
    const partText = document.createElement('span');
    partText.textContent = EQUIP_PART_LABELS[part];
    const partSelect = document.createElement('select');
    partSelect.dataset.equipLevel = part;
    // 장비는 세 갈래다 — 미장착 / 일반 T1~T9(강화 없음) / 기업·오버로드 강화 0~5.
    // 미장착을 «강화 0»으로 적으면 안 낀 부위가 플랫 스탯을 얻어 딜이 부푼다.
    // 스킬 레벨과 같은 방향(낮은 값이 위)으로 둔다 — 한 패널 안에서 정렬이
    // 엇갈리면 고를 때마다 방향을 다시 읽어야 한다.
    const addOption = (value: string, label: string) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      partSelect.append(option);
    };
    addOption('없음', '미장착');
    for (let tier = 1; tier <= 9; tier += 1) addOption(`T${tier}`, `T${tier}`);
    for (let lv = 0; lv <= 5; lv += 1) addOption(String(lv), `기업 Lv${lv}`);
    partSelect.value = String(current.equipLevels?.[part] ?? 5);
    partSelect.addEventListener('change', () => {
      const next = cloneOverrides(current);
      const levels = { ...(next.equipLevels ?? {}) };
      for (const p of EQUIP_PARTS) levels[p] ??= current.equipLevels?.[p] ?? 5;
      const picked = partSelect.value;
      levels[part] = /^\d+$/.test(picked) ? Number(picked) : (picked as EquipSetting);
      next.equipLevels = levels;
      emitNumericChange(next);
    });
    partLabel.append(partText, partSelect);
    equipGrid.append(partLabel);
  }
  const equipNote = document.createElement('p');
  equipNote.className = 'field-note';
  equipNote.textContent = '부위별 장비 · 미장착 / 일반 T1~T9(강화 없음) / 기업·오버로드 강화 0~5. 오버로드 옵션과 별개인 장비 기본 스탯입니다.';
  equipEditor.append(equipHeading, equipGrid, equipNote);
  body.append(equipEditor);

  // 소장품 / 애장품 — 같은 슬롯이라 한 목록에서 고른다. 애장품이 있는 캐릭터만
  // 애장품 단계가 선택지에 나온다.
  const collectionEditor = document.createElement('section');
  collectionEditor.className = 'collection-editor';
  const collectionHeading = document.createElement('h4');
  collectionHeading.textContent = defaults.favoriteItem ? '소장품 · 애장품' : '소장품';
  const collectionSelect = document.createElement('select');
  collectionSelect.dataset.collection = '';
  const collectionOptions: Array<{ value: string; label: string }> = [
    ...(defaults.favoriteItem
      ? [3, 2, 1].map((stage) => ({
        value: `favorite:${stage}`,
        label: `애장품 ${'★'.repeat(stage)}${'☆'.repeat(3 - stage)}`,
      }))
      : []),
    ...catalog.collectionStages.map((stage) => ({ value: `stage:${stage}`, label: stage })),
  ];
  for (const option of collectionOptions) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    collectionSelect.append(node);
  }
  collectionSelect.value = current.collection!.favorite > 0
    ? `favorite:${current.collection!.favorite}`
    : `stage:${current.collection!.stage}`;
  collectionSelect.addEventListener('change', () => {
    const [kind, raw] = collectionSelect.value.split(':');
    const next = cloneOverrides(current);
    next.collection = kind === 'favorite'
      ? { stage: 'SR15', favorite: Number(raw) }
      : { stage: raw!, favorite: 0 };
    commit(next);
  });
  const collectionNote = document.createElement('p');
  collectionNote.className = 'field-note';
  collectionNote.textContent = defaults.favoriteItem
    ? `${defaults.favoriteItem.name} 보유 시 애장품을, 아니면 실제 낀 소장품 단계를 고르세요. 애장품은 소장품 슬롯을 씁니다.`
    : '실제로 장착한 소장품 등급·레벨입니다. 안 꼈으면 «없음»을 고르세요.';
  collectionEditor.append(collectionHeading, collectionSelect, collectionNote);
  body.append(collectionEditor);

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
  const chargeOptionNote = document.createElement('p');
  chargeOptionNote.className = 'field-note';
  chargeOptionNote.textContent = '차지형 무기가 아니면 차지 옵션은 효과가 없습니다.';
  body.append(chargeOptionNote);

  const cubeBox = document.createElement('section');
  cubeBox.className = 'cube-editor';
  const cubeHeading = document.createElement('h4');
  cubeHeading.textContent = '하모니 큐브';
  const cubeControls = document.createElement('div');
  cubeControls.className = 'cube-controls';
  const cubeSelect = document.createElement('select');
  cubeSelect.dataset.cubeName = '';
  // 선택지는 카탈로그(=cube.json)에서 그대로 온다. 새 큐브가 추가돼도 코드는 그대로다.
  for (const cubeName of Object.keys(catalog.cubes)) {
    const option = document.createElement('option');
    option.value = cubeName;
    option.textContent = cubeName;
    cubeSelect.append(option);
  }
  // 저장된 편성이 지금 카탈로그에 없는 큐브를 가리킬 수 있다(데이터 갱신·구버전 상태).
  // 그때는 목록의 첫 큐브로 되돌려 UI가 통째로 죽지 않게 한다.
  const cubeNames = Object.keys(catalog.cubes);
  const cubeName = catalog.cubes[current.cube.name] ? current.cube.name : cubeNames[0]!;
  const cubeMeta = catalog.cubes[cubeName]!;
  cubeSelect.value = cubeName;
  const levelSelect = document.createElement('select');
  levelSelect.dataset.cubeLevel = '';
  const availableLevels = Object.keys(cubeMeta.levels)
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
    if (!catalog.cubes[next.cube.name]?.levels[String(next.cube.level)]) {
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
  const level = cubeMeta.levels[String(current.cube.level)];
  const cubeSummary = document.createElement('p');
  cubeSummary.className = 'cube-summary';
  if (level) {
    const effect = cubeMeta.template.replace('{0}', String(level.effect));
    cubeSummary.textContent = `공격 ${level.atk.toLocaleString('en-US')} · 방어 ${level.def.toLocaleString('en-US')} · `
      + `체력 ${level.hp.toLocaleString('en-US')} · ${effect} · 우월 코드 ${level.commonElement}%`;
  }
  cubeBox.append(cubeHeading, cubeControls, cubeSummary);
  // 고유 스킬이 계산에 안 들어가는 큐브는 그 사실을 숨기지 않는다. 스탯은 붙으므로
  // 선택 자체는 의미가 있고, 표시된 효과 수치만 결과에 반영되지 않는다.
  if (cubeMeta.unsupported) {
    const note = document.createElement('p');
    note.className = 'cube-unsupported-note';
    note.dataset.cubeUnsupported = '';
    note.textContent = `이 큐브의 고유 효과는 아직 계산에 반영되지 않습니다 — `
      + `공격력·방어력·체력과 우월 코드 효과만 적용됩니다. (${cubeMeta.unsupported})`;
    cubeBox.append(note);
  }
  body.append(cubeBox);

  const controlEditor = document.createElement('section');
  controlEditor.className = 'control-editor';
  const controlMode = document.createElement('div');
  controlMode.className = 'control-mode';
  const isAutomatic = current.control === undefined;
  for (const [mode, labelText] of [
    ['auto', '추천 자동 적용'],
    ['manual', '직접 설정'],
  ] as const) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `control-mode-${name}`;
    radio.dataset.controlMode = mode;
    radio.checked = mode === 'auto' ? isAutomatic : !isAutomatic;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const next = cloneOverrides(current);
      if (mode === 'auto') delete next.control;
      else next.control = {};
      commit(next);
    });
    label.append(radio, document.createTextNode(labelText));
    controlMode.append(label);
  }
  const recommendation = document.createElement('p');
  recommendation.className = 'field-note';
  const recommendedNames = Object.keys(defaults.recommendedControl);
  recommendation.textContent = recommendedNames.length
    ? `현재 기본 추천: ${recommendedNames.join(', ')}`
    : '현재 기본 추천: 자동 사격';
  if (defaults.hasConditionalControl) {
    recommendation.textContent += ' · 스쿼드 조합에 따라 추천 컨트롤이 추가됩니다.';
  }

  const controlGrid = document.createElement('div');
  controlGrid.className = 'control-grid';
  const displayedControl = isAutomatic ? defaults.recommendedControl : current.control!;
  const updateControl = (key: keyof CharacterControl, entry: CharacterControl[typeof key] | undefined) => {
    const next = cloneOverrides(current);
    const nextControl: CharacterControl = { ...(next.control ?? {}) };
    if (entry === undefined) delete nextControl[key];
    else Object.assign(nextControl, { [key]: entry });
    next.control = nextControl;
    commit(next);
  };
  const addControlToggle = (
    key: keyof CharacterControl,
    labelText: string,
    enabledValue: CharacterControl[typeof key],
  ): HTMLLabelElement => {
    const label = document.createElement('label');
    label.className = 'inline-check control-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.control = key;
    checkbox.checked = displayedControl[key] !== undefined;
    checkbox.disabled = isAutomatic;
    checkbox.addEventListener('change', () => {
      updateControl(key, checkbox.checked ? enabledValue : undefined);
    });
    label.append(checkbox, document.createTextNode(labelText));
    controlGrid.append(label);
    return label;
  };

  if (defaults.weaponType === 'SR' || defaults.weaponType === 'RL') {
    const tapLabel = addControlToggle('tap_fire', '톡톡이', { rate: TAP_FIRE_DEFAULT, release: 0.03 });
    // 발사 속도는 사람마다 다르다. 커뮤니티는 10초당 발수(«N톡톡이»)로 부르므로
    // 입력은 발/초로 받되 환산값을 같이 보여준다.
    const tapRate = document.createElement('input');
    tapRate.type = 'number';
    tapRate.dataset.tapRate = '';
    tapRate.step = '0.1';
    tapRate.min = '0.1';
    tapRate.max = '20';
    tapRate.value = String(displayedControl.tap_fire?.rate ?? TAP_FIRE_DEFAULT);
    tapRate.disabled = isAutomatic || displayedControl.tap_fire === undefined;
    const tapHint = document.createElement('small');
    tapHint.className = 'tap-rate-hint';
    tapHint.dataset.tapHint = '';
    const paintHint = (rate: number) => {
      if (!Number.isFinite(rate) || rate <= 0) { tapHint.textContent = ''; return; }
      // 10초에 N발이면 사이클은 10/(N-1)초다 (CONTROL.md §톡톡이).
      tapHint.textContent = `≈ ${Math.round(rate * 10)}톡톡이`
        + (rate > TAP_FIRE_HARD_LIMIT ? ' · 게임 하한(220ms)을 넘는 값입니다' : '');
      tapHint.classList.toggle('is-warning', rate > TAP_FIRE_HARD_LIMIT);
    };
    paintHint(Number(tapRate.value));
    tapRate.addEventListener('input', () => {
      const rate = Number(tapRate.value);
      paintHint(rate);
      if (!Number.isFinite(rate) || rate <= 0) return;
      const next = cloneOverrides(current);
      next.control = { ...(next.control ?? {}), tap_fire: { rate, release: 0.03 } };
      emitNumericChange(next);
    });
    tapLabel.append(makeInputUnit(tapRate, '발/초'), tapHint);
    const holdLabel = addControlToggle('hold', '홀드 컨트롤', {
      policy: 'own_full_burst', lead: 0.5,
    });
    const holdPolicy = document.createElement('select');
    holdPolicy.dataset.controlPolicy = 'hold';
    for (const [policy, text] of [
      ['own_full_burst', '본인 풀버스트 홀드'],
      ['charge_hold_after_fb', '풀버스트 후 홀드'],
    ] as const) {
      const option = document.createElement('option');
      option.value = policy;
      option.textContent = text;
      holdPolicy.append(option);
    }
    holdPolicy.value = displayedControl.hold?.policy ?? 'own_full_burst';
    holdPolicy.disabled = isAutomatic || displayedControl.hold === undefined;
    holdPolicy.addEventListener('change', () => {
      updateControl('hold', {
        policy: holdPolicy.value as 'own_full_burst' | 'charge_hold_after_fb',
        lead: holdPolicy.value === 'own_full_burst' ? 0.5 : 0.1,
      });
    });
    holdLabel.append(holdPolicy);
  }

  const reloadLabel = addControlToggle('reload', '재장전 컨트롤', {
    policy: 'before_fb_end', lead: 0.3,
  });
  const reloadPolicy = document.createElement('select');
  reloadPolicy.dataset.controlPolicy = 'reload';
  for (const [policy, text] of [
    ['before_fb_end', '풀버스트 종료 전'],
    ['into_fb', '풀버스트 진입 맞춤'],
  ] as const) {
    const option = document.createElement('option');
    option.value = policy;
    option.textContent = text;
    reloadPolicy.append(option);
  }
  reloadPolicy.value = displayedControl.reload?.policy ?? 'before_fb_end';
  reloadPolicy.disabled = isAutomatic || displayedControl.reload === undefined;
  reloadPolicy.addEventListener('change', () => {
    updateControl('reload', reloadPolicy.value === 'before_fb_end'
      ? { policy: 'before_fb_end', lead: 0.3 }
      : { policy: 'into_fb', margin: 0.1 });
  });
  reloadLabel.append(reloadPolicy);
  addControlToggle('cover', '버스트 엄폐 컨트롤', { policy: 'own_full_burst' });

  if (name === '신데렐라 : 크리스탈 웨이브') {
    const modeLabel = document.createElement('label');
    modeLabel.className = 'inline-check control-toggle weapon-mode-swap';
    const modeCheckbox = document.createElement('input');
    modeCheckbox.type = 'checkbox';
    modeCheckbox.dataset.weaponModeSwap = '';
    modeCheckbox.checked = current.weaponModeSwapAt !== undefined;
    const modeDelay = document.createElement('input');
    modeDelay.type = 'number';
    modeDelay.dataset.weaponModeSwapAt = '';
    modeDelay.min = '0';
    modeDelay.max = '180';
    modeDelay.step = '0.1';
    modeDelay.value = String(current.weaponModeSwapAt ?? WEAPON_MODE_SWAP_DEFAULT);
    modeDelay.disabled = current.weaponModeSwapAt === undefined;
    modeCheckbox.addEventListener('change', () => {
      const next = cloneOverrides(current);
      if (modeCheckbox.checked) next.weaponModeSwapAt = WEAPON_MODE_SWAP_DEFAULT;
      else delete next.weaponModeSwapAt;
      commit(next);
    });
    modeDelay.addEventListener('input', () => {
      const at = Number(modeDelay.value);
      if (!Number.isFinite(at) || at < 0 || at > 180) return;
      const next = cloneOverrides(current);
      next.weaponModeSwapAt = at;
      emitNumericChange(next);
    });
    modeLabel.append(
      modeCheckbox,
      document.createTextNode('저격 모드로 변경 · 전투 시작 '),
      makeInputUnit(modeDelay, '초'),
      document.createTextNode('후부터 전환 시도'),
    );
    controlGrid.append(modeLabel);
  }

  const controlWarning = document.createElement('p');
  controlWarning.className = 'field-note warning';
  controlWarning.textContent = '여러 캐릭터 동시 컨트롤은 실제 한 명 조작보다 유리한 상한일 수 있습니다.';
  // 컨트롤은 따로 접는다. 손대는 사람은 적은데 자리는 가장 많이 먹는다.
  const controlFold = disclosure('컨트롤', 'data-control-open', controlWasOpen);
  controlFold.panel.append(controlMode, recommendation, controlGrid, controlWarning);
  controlEditor.append(controlFold.head, controlFold.panel);
  // 컨트롤은 돌파·스킬·오버로드·큐브와 **형제**로 둔다. 그 안에 넣으면 컨트롤만
  // 보려 해도 설정 뭉치를 먼저 펼쳐야 한다 — 두 뭉치는 만지는 이유가 다르다.

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
  const bodyFold = disclosure('돌파 · 스킬 · 오버로드 · 큐브', 'data-settings-open', bodyWasOpen);
  bodyFold.panel.append(body);
  container.append(bodyFold.head, bodyFold.panel, controlEditor);
}
