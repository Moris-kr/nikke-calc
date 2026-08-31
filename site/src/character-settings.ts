import type {
  BuffTargetRow,
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
    + `${cube.name === NO_CUBE ? '큐브 없음' : `${cube.name} Lv${cube.level}`} · ${controlSummary}`;
}

/**
 * 컨트롤 키의 한글 이름. 판의 체크박스에 적히는 말과 **같은 말**을 쓴다 —
 * 추천 줄에서 「tap_fire」라고 읽고 아래에서 「톡톡이」를 찾으면 같은 것인 줄 모른다.
 */
export const CONTROL_NAMES: Record<string, string> = {
  tap_fire: '톡톡이',
  hold: '홀드 컨트롤',
  reload: '재장전 컨트롤',
  cover: '버스트 엄폐 컨트롤',
};

/** 컨트롤 키 → 한글. 모르는 키는 그대로 둔다(새 컨트롤이 생겨도 빈칸이 되지 않는다). */
export const controlName = (key: string): string => CONTROL_NAMES[key] ?? key;

/**
 * 「지금 이 조합에서 실제로 걸리는 컨트롤」 문구.
 *
 * 캐릭터별 기본 컨트롤에는 **조합 조건부**가 있다(아인은 에이다와 함께일 때 홀드가
 * 붙는다). 예전에는 조건 없는 것만 적고 「조합에 따라 추가됩니다」로 얼버무려,
 * 실제로 걸려 있는 홀드를 아무도 볼 수 없었다 — 그래서 «홀드를 켰는데 결과가
 * 그대로»라는 말이 나왔다. 이미 걸려 있었기 때문이다.
 *
 * `squad`를 주지 않으면(이 모듈만 따로 그리는 곳) 조건 없는 것만 적는다.
 */
export function recommendedControlText(
  defaults: { recommendedControl: CharacterControl; hasConditionalControl: boolean;
    conditionalControl?: Array<{ withMembers: string[]; control: CharacterControl }> },
  squad?: string[],
): string {
  const names = Object.keys(defaults.recommendedControl).map(controlName);
  const rules = defaults.conditionalControl ?? [];
  const roster = new Set((squad ?? []).filter(Boolean));
  let unresolved = !defaults.hasConditionalControl ? false : rules.length === 0;
  for (const rule of rules) {
    const who = rule.withMembers.find((member) => roster.has(member));
    if (!who) { unresolved = unresolved || squad === undefined; continue; }
    for (const key of Object.keys(rule.control)) {
      names.push(`${controlName(key)}(${who}와 함께라서)`);
    }
  }
  const head = names.length ? `현재 기본 추천: ${names.join(' · ')}` : '현재 기본 추천: 자동 사격';
  return unresolved ? `${head} · 스쿼드 조합에 따라 추천 컨트롤이 추가됩니다.` : head;
}

/** 조합 조건부 컨트롤 한 줄 — 지금 걸렸는지와, 왜 걸리는지. */
export interface ControlRuleNote {
  /** 지금 이 스쿼드에서 실제로 걸려 있는가. */
  active: boolean;
  /** 「에이다와 함께라서 홀드 컨트롤이 걸려 있습니다」 같은 한 줄. */
  headline: string;
  /** 왜 그렇게 하는지. 데이터에 적힌 설명이 없으면 비어 있다. */
  help: string;
}

/**
 * 조합으로 붙는 컨트롤을 **왜 붙는지까지** 풀어 쓴다.
 *
 * 이 컨트롤들은 아무도 켠 적이 없는데 걸린다 — 그래서 「홀드를 켰는데 결과가 그대로」,
 * 「추천에 없는 게 왜 도나」 같은 오해가 나온다. 걸린 것은 걸렸다고, 아직 아닌 것은
 * 무엇과 함께 두면 걸리는지 적어 둔다.
 *
 * 설명은 데이터가 들고 온다(`data/char_defaults.json`의 `_help`) — 화면이 지어내지 않는다.
 */
/**
 * 받침에 맞춰 조사를 고른다 — 「홀드 컨트롤이」와 「톡톡이가」.
 *
 * 「이(가)」로 뭉개는 편이 짧지만, 카드 안에서 매번 읽히는 문장이라 그대로 두면
 * 눈에 걸린다. 한글이 아닌 글자로 끝나면(숫자·영문) 받침이 있는 쪽으로 본다.
 */
export function withParticle(word: string, withFinal: string, without: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  const hasFinal = hangul ? (code - 0xac00) % 28 !== 0 : true;
  return `${word}${hasFinal ? withFinal : without}`;
}

export function controlRuleNotes(
  defaults: { conditionalControl?: Array<{ withMembers: string[]; control: CharacterControl; help?: string }> },
  squad?: string[],
): ControlRuleNote[] {
  const roster = new Set((squad ?? []).filter(Boolean));
  return (defaults.conditionalControl ?? []).map((rule) => {
    const names = Object.keys(rule.control).map(controlName).join(' · ');
    const here = rule.withMembers.find((member) => roster.has(member));
    const who = here ?? rule.withMembers.join(' 또는 ');
    const subject = withParticle(names, '이', '가');
    return {
      active: Boolean(here),
      headline: here
        ? `${withParticle(who, '과', '와')} 함께라서 ${subject} 걸려 있습니다.`
        : `${withParticle(who, '과', '와')} 함께 편성하면 ${subject} 자동으로 붙습니다.`,
      help: rule.help ?? '',
    };
  });
}

/** 큐브를 끼지 않은 상태. 데이터가 아니라 화면이 만드는 선택지다. */
export const NO_CUBE = '없음';

/** 막바지 최우선의 기본 구간(초). 엔진 기본값(`calculator/customization.py`)과 같다. */
const ENDGAME_DEFAULT = 20;

/** 창으로 여는 설정 뭉치의 종류. 컨트롤은 카드에서 그 자리에 펼친다. */
export type CharPanelKind = 'settings';

/**
 * 컨트롤 칩에 적히는 한 줄. **열지 않아도 지금 상태를 읽을 수 있어야** 칩이 값을 한다 —
 * 대부분은 «추천 자동 · 버스트 자동»이라 열어 볼 일이 없다.
 */
export function controlChipText(value?: CharacterOverrides): string {
  const picked = value?.control === undefined ? -1 : Object.keys(value.control).length;
  // 하나도 안 고른 «직접»은 «직접 0개»가 아니라 그냥 직접이다 — 0을 세어 보일 이유가 없다.
  const control = picked < 0 ? '추천 자동' : picked === 0 ? '직접 설정' : `직접 ${picked}개`;
  const burst = value?.burst;
  const burstText = burst === undefined ? '버스트 자동'
    : burst.mode === 'priority' ? `버스트 ${burst.every}의 배수`
    : burst.mode === 'endgame' ? `버스트 막바지 ${burst.seconds}초`
    : '버스트 안 씀';
  return `${control} · ${burstText}`;
}

/**
 * 지난번에 그린 «창으로 여는» 뭉치들. 창으로 띄우면 그 뭉치는 카드 밖(모달)으로
 * 옮겨 가므로, 다시 그릴 때 카드만 뒤져서는 펼침 상태를 찾을 수 없다 — 고급 모드를
 * 켜 둔 채 «수치 추가»를 누르면 고급 모드가 꺼져 보이던 게 그 탓이다.
 */
const lastPanels = new WeakMap<HTMLElement, HTMLElement[]>();

export function renderCharacterSettings(
  container: HTMLElement,
  name: string,
  catalog: SettingsCatalog,
  value: CharacterOverrides | undefined,
  onChange: (next: CharacterOverrides | undefined) => void,
  buffTargets?: BuffTargetRow[],
  onShowOrder?: (row: BuffTargetRow) => void,
  /**
   * 설정 뭉치를 **창으로** 여는 자리. 안 주면 그 자리에서 펼친다 —
   * 이 모듈만 따로 그리는 곳(테스트·미리보기)에서도 쓸 수 있어야 한다.
   */
  onOpenPanel?: (kind: CharPanelKind, panel: HTMLElement, label: string) => void,
  /**
   * 지금 편성된 스쿼드 전원. **조합 조건부 컨트롤을 판정하는 데만** 쓴다 —
   * 안 주면 조건 없는 추천만 적고 예전처럼 «조합에 따라 추가됩니다»로 알린다.
   */
  squad?: string[],
): void {
  // 지난번 화면을 찾는다. 카드 안이 먼저고, 없으면 창으로 옮겨 간 뭉치까지 뒤진다.
  const previous = <T extends Element>(selector: string): T | null => {
    const inCard = container.querySelector<T>(selector);
    if (inCard) return inCard;
    for (const panel of lastPanels.get(container) ?? []) {
      const hit = panel.querySelector<T>(selector);
      if (hit) return hit;
    }
    return null;
  };
  const advancedWasOpen = previous<HTMLInputElement>('[data-advanced-toggle]')?.checked ?? false;
  const searchWas = previous<HTMLInputElement>('[data-manual-search]')?.value ?? '';
  // 펼침 상태는 다시 그려도 유지한다. 값을 하나 바꿀 때마다 접히면 쓸 수 없다.
  // 기본값은 **접힘**이다 — 카드 다섯 장이 한 화면에 서니, 켜 두기만 한 설정까지
  // 늘 펼쳐져 있으면 편성 자체가 안 보인다.
  const wasOpen = (flag: string): boolean =>
    previous<HTMLElement>(`[${flag}]`)?.getAttribute('aria-expanded') === 'true';
  const summaryWasOpen = wasOpen('data-loadout-open');
  const controlWasOpen = wasOpen('data-control-open');
  // 접이판 상태는 **카드를 비우기 전에** 읽어 둔다. 아래에서 다시 그릴 때는 옛 화면이
  // 이미 지워져 있어, 그때 찾아서는 늘 «접힘»만 나온다.
  const openNotes = new Set(
    [...container.querySelectorAll<HTMLDetailsElement>('[data-note-fold]')]
      .filter((fold) => fold.open)
      .map((fold) => fold.dataset.noteFold!),
  );

  /**
   * 눌러서 여는 설정 뭉치. 카드가 좁아 그 자리에서 펼치면 다섯 장이 서로를 밀어낸다 —
   * 필터 판처럼 창으로 띄운다. 창을 못 여는 자리에서는 제자리 펼치기로 물러난다.
   */
  const panelOpener = (label: string, kind: CharPanelKind, short = label) => {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'char-panel-open';
    head.dataset.charPanelOpen = kind;
    head.setAttribute('aria-expanded', 'false');
    // 카드에는 짧은 이름을, 창 제목에는 온전한 이름을 쓴다 — 좁은 칸에서 라벨이
    // 줄줄이 깨지면 무엇을 여는 단추인지부터 읽히지 않는다.
    const title = document.createElement('span');
    title.className = 'disclosure-label';
    title.textContent = short;
    title.title = label;
    const hint = document.createElement('span');
    hint.className = 'disclosure-hint';
    hint.textContent = '›';
    head.append(title, hint);
    const panel = document.createElement('div');
    panel.className = 'disclosure-panel char-panel';
    panel.dataset.charPanel = kind;
    panel.hidden = true;
    head.addEventListener('click', () => {
      if (onOpenPanel) { onOpenPanel(kind, panel, label); return; }
      const next = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(next));
      panel.hidden = !next;
      hint.textContent = next ? '접기' : '열기';
    });
    return { head, panel };
  };

  container.replaceChildren();
  container.className = 'character-settings';

  const commit = (next: CharacterOverrides | undefined) => {
    onChange(next);
    renderCharacterSettings(
      container, name, catalog, next, onChange, buffTargets, onShowOrder, onOpenPanel, squad);
  };

  // 카드가 좁아졌다 — 요약(«1돌 · 호감도 20 · 스킬 10…»)과 버프 수령자는 접어 두고
  // 필요한 사람만 펼친다. 편성 화면에서 늘 읽는 줄은 아니다.
  const summaryFold = document.createElement('button');
  summaryFold.type = 'button';
  summaryFold.className = 'loadout-open';
  summaryFold.dataset.loadoutOpen = '';
  summaryFold.setAttribute('aria-expanded', String(summaryWasOpen));
  summaryFold.append(document.createTextNode('개별값'));
  const summaryCaret = document.createElement('b');
  summaryCaret.className = 'loadout-caret';
  summaryCaret.textContent = summaryWasOpen ? '▴' : '▾';
  summaryFold.append(summaryCaret);
  const summaryBox = document.createElement('div');
  summaryBox.className = 'loadout-fold';
  summaryBox.dataset.loadoutFold = '';
  summaryBox.hidden = !summaryWasOpen;
  summaryFold.addEventListener('click', () => {
    const next = summaryFold.getAttribute('aria-expanded') !== 'true';
    summaryFold.setAttribute('aria-expanded', String(next));
    summaryBox.hidden = !next;
    summaryCaret.textContent = next ? '▴' : '▾';
  });
  const settingsRow = document.createElement('div');
  settingsRow.className = 'settings-row';
  settingsRow.append(summaryFold);
  container.append(settingsRow, summaryBox);

  const summary = document.createElement('p');
  summary.className = 'loadout-summary';
  summary.dataset.loadoutSummary = '';
  summary.textContent = summaryText(name, catalog, value);
  summaryBox.append(summary);

  // 「누가 이 버프를 받았나」. 대상이 공격력 순위로 갈려 편성만 보고는 알 수 없고
  // 전투 중에 바뀌기도 해서, 추정하지 않고 **실제 발동 로그**의 수령자를 띄운다.
  // 계산을 돌리기 전에는 아직 알 수 없으므로 빈 괄호로 자리만 잡는다.
  //
  // 접이(개별값) **밖**에 세운다. 리버렐리오·미란다처럼 대상이 갈리는 버프는
  // 결과를 읽는 데 필요한 정보이지 내 육성값이 아니다 — 펴 보지 않으면 못 보는
  // 자리에 두면 있는 줄도 모른다.
  const buffTargetList = document.createElement('div');
  buffTargetList.className = 'buff-target-list';
  for (const row of buffTargets ?? []) {
    const box = document.createElement('p');
    box.className = 'buff-target';
    box.dataset.buffTarget = row.buff;
    const label = document.createElement('span');
    label.textContent = `${row.label} : `;
    box.append(label);
    const who = document.createElement('b');
    // 대상이 전투 중 갈리면 이름을 나열해도 읽히지 않는다 — 특이케이스로 접고
    // 실제 순서는 「순서보기」로 넘긴다.
    const special = row.targets.length > 1;
    // 미리 계산은 배경에서 돈다. 빈 괄호만 보이면 기능이 꺼진 것처럼 보이므로
    // 도는 동안은 그렇다고 적는다.
    who.textContent = row.pending ? '[계산중]'
      : special ? '[특이케이스]'
        : `[${row.targets.join(', ')}]`;
    if (row.pending) box.classList.add('is-pending');
    box.append(who);
    box.title = row.pending
      ? `${row.buff} — 대상을 계산하는 중입니다`
      : row.targets.length === 0
        ? `${row.buff} — 아직 계산하지 않았거나 발동 조건이 맞지 않습니다`
        : special
          ? `${row.buff} — ${row.count}회 발동 · 대상이 ${row.targets.length}명 사이에서 갈립니다`
          : `${row.buff} — ${row.count}회 발동`;

    // 순서보기는 대상이 갈릴 때만 — 고정 대상은 이름만으로 충분하다.
    if (onShowOrder && special && (row.sequence?.length ?? 0) > 0) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'buff-order-open';
      open.dataset.buffOrderOpen = row.buff;
      open.textContent = '순서보기';
      open.addEventListener('click', () => onShowOrder(row));
      box.append(open);
    }
    buffTargetList.append(box);
  }
  if (buffTargetList.childElementCount > 0) container.append(buffTargetList);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'inline-check';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = Boolean(value);
  toggle.dataset.customToggle = '';
  const toggleText = document.createElement('span');
  toggleText.textContent = '개별 설정';
  toggleLabel.append(toggle, toggleText);
  settingsRow.append(toggleLabel);
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
  /** 컨트롤 칩의 글을 지금 값으로 고쳐 쓴다. 칩이 만들어진 뒤에 채워진다. */
  let paintControlChip: () => void = () => undefined;

  /**
   * 긴 안내문을 접어 둔다. 카드 폭(약 130px)에서는 네 문장이 열 줄을 넘겨,
   * 정작 만지러 온 체크박스가 화면 밖으로 밀린다. 읽고 싶을 때만 편다 —
   * 펼침 상태는 다시 그려도 남는다.
   */
  const foldedNote = (label: string, note: HTMLElement, key: string): HTMLElement => {
    const fold = document.createElement('details');
    fold.className = 'note-fold';
    fold.dataset.noteFold = key;
    fold.open = openNotes.has(key);
    const head = document.createElement('summary');
    head.textContent = label;
    fold.append(head, note);
    return fold;
  };

  const emitNumericChange = (next: CharacterOverrides) => {
    current = cloneOverrides(next);
    onChange(current);
    summary.textContent = summaryText(name, catalog, current);
    // 버스트를 바꾸면 카드를 다시 그리지 않는다 — 칩에 적힌 글은 여기서 따라간다.
    paintControlChip();
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
  const burstLast = current.burst?.mode === 'endgame' ? current.burst.seconds : ENDGAME_DEFAULT;

  const burstRow = document.createElement('div');
  burstRow.className = 'burst-row';
  const burstSelect = document.createElement('select');
  burstSelect.dataset.burstAssignment = '';
  for (const [optionValue, optionLabel] of [
    ['auto', '자동'], ['priority', 'n의 배수 우선 사용'],
    ['endgame', '막바지 최우선'], ['skip', '안 씀'],
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

  // 막바지 최우선 — 큰 한 방을 전투 끝에 맞추려는 운용이다.
  const lastWrap = document.createElement('label');
  lastWrap.className = 'burst-every';
  lastWrap.hidden = burstMode !== 'endgame';
  const lastText = document.createElement('span');
  lastText.textContent = '남은 시간';
  const lastInput = document.createElement('input');
  lastInput.type = 'number';
  lastInput.min = '1';
  lastInput.max = '180';
  lastInput.step = '1';
  lastInput.value = String(burstLast);
  lastInput.dataset.burstLast = '';
  const lastUnit = document.createElement('span');
  lastUnit.textContent = '초 미만일 때';
  lastWrap.append(lastText, lastInput, lastUnit);

  burstRow.append(burstSelect, everyWrap, lastWrap);

  const applyBurst = () => {
    const next = cloneOverrides(current);
    const mode = burstSelect.value;
    if (mode === 'priority') {
      const n = Math.max(1, Math.trunc(Number(everyInput.value) || 1));
      next.burst = { mode: 'priority', every: n };
    } else if (mode === 'endgame') {
      const seconds = Math.min(180, Math.max(1, Math.trunc(Number(lastInput.value) || ENDGAME_DEFAULT)));
      next.burst = { mode: 'endgame', seconds };
    } else if (mode === 'skip') {
      next.burst = { mode: 'skip' };
    } else {
      delete next.burst;
    }
    emitNumericChange(next);
  };
  burstSelect.addEventListener('change', () => {
    everyWrap.hidden = burstSelect.value !== 'priority';
    lastWrap.hidden = burstSelect.value !== 'endgame';
    applyBurst();
  });
  everyInput.addEventListener('input', applyBurst);
  lastInput.addEventListener('input', applyBurst);

  const burstNote = document.createElement('p');
  burstNote.className = 'field-note';
  burstNote.textContent =
    '같은 버스트 단계 후보가 여럿일 때 누가 먼저 쓰는지를 정합니다(쿨타임 한도 내).'
    + ' «n의 배수»는 그 사이클마다 우선 사용하고(n=1이면 매 사이클),'
    + ' «막바지 최우선»은 전투가 그만큼 남았을 때부터 누구보다 먼저 씁니다 — 그 전에는 평소 순서입니다.'
    + ' «안 씀»은 이 캐릭터가 버스트를 아예 쓰지 않습니다 — 같은 단계 동료가 전부 쿨이어도 나가지 않으므로,'
    + ' 그 단계를 맡을 동료가 없으면 버스트 사이클 자체가 멈춥니다.';
  burstEditor.append(burstHeading, burstRow, foldedNote('버스트 운용 설명', burstNote, 'burst'));
  // `body`가 아니라 아래 «컨트롤 · 버스트» 접이판에 넣는다 — 버스트 운용도 결국
  // 조작 방식이라 컨트롤과 한자리에 있는 편이 찾기 쉽다.

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
    // 장비는 세 갈래다 — 미장착 / 일반 T1~T9(강화 없음) / 오버로드 강화 0~5.
    // 고를 수 있는 건 미장착과 오버로드 0~5강뿐이고, 일반 등급은 옛 설정·계정
    // 가져오기로 들어온 값일 때만 목록에 남는다.
    // 미장착을 «강화 0»으로 적으면 안 낀 부위가 플랫 스탯을 얻어 딜이 부푼다.
    // 스킬 레벨과 같은 방향(낮은 값이 위)으로 둔다 — 한 패널 안에서 정렬이
    // 엇갈리면 고를 때마다 방향을 다시 읽어야 한다.
    const addOption = (value: string, label: string) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      partSelect.append(option);
    };
    // 실전에서 쓰는 것만 남긴다 — 일반 T1~T9는 골라 봐야 쓸 일이 없어 아예 뺐다.
    // 강화 0단계는 「T9 기업」이 아니라 인게임 표기대로 「오버로드 0강」으로 적는다:
    // 계산도 그쪽(오버로드 강화 0)으로 하고 있었으므로 이름이 계산을 따라간 것이다.
    addOption('없음', '미장착');
    addOption('0', '오버로드 0강');
    for (let lv = 1; lv <= 5; lv += 1) addOption(String(lv), `오버로드 ${lv}강`);
    const currentEquip = String(current.equipLevels?.[part] ?? 5);
    // 옛 설정이나 계정 가져오기가 일반 T1~T9를 가리키면 그 값도 목록에 남겨 둔다 —
    // 조용히 바뀌면 안 된다. 계산은 그대로 일반 장비 표로 한다.
    if (![...partSelect.options].some((option) => option.value === currentEquip)) {
      addOption(currentEquip, `${currentEquip} (옛 설정)`);
    }
    partSelect.value = currentEquip;
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
  equipNote.textContent = '부위별 장비 · 미장착 / 오버로드 0~5강. '
    + '오버로드 «옵션»(우코·공증 등)과는 별개인 장비 기본 스탯입니다. '
    + '오버로드 0강 이하(T9 기업 포함)는 전부 오버로드 0강으로 계산합니다.';
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
  // 맨 앞의 «없음»만 데이터가 아니라 화면이 만든다 — 큐브 효과가 오히려 손해인 조합
  // (미란다 버프 등)을 재려면 안 낀 상태도 고를 수 있어야 한다.
  const noneOption = document.createElement('option');
  noneOption.value = NO_CUBE;
  noneOption.textContent = '없음 (큐브 미착용)';
  cubeSelect.append(noneOption);
  for (const cubeName of Object.keys(catalog.cubes)) {
    const option = document.createElement('option');
    option.value = cubeName;
    option.textContent = cubeName;
    cubeSelect.append(option);
  }
  // 저장된 편성이 지금 카탈로그에 없는 큐브를 가리킬 수 있다(데이터 갱신·구버전 상태).
  // 그때는 목록의 첫 큐브로 되돌려 UI가 통째로 죽지 않게 한다.
  const cubeNames = Object.keys(catalog.cubes);
  const noCube = current.cube.name === NO_CUBE;
  const cubeName = noCube ? NO_CUBE
    : (catalog.cubes[current.cube.name] ? current.cube.name : cubeNames[0]!);
  const cubeMeta = catalog.cubes[cubeName] ?? catalog.cubes[cubeNames[0]!]!;
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
  levelSelect.value = String(noCube ? 15 : current.cube.level);
  levelSelect.disabled = noCube;
  cubeSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    if (cubeSelect.value === NO_CUBE) {
      // 안 낀 상태에는 레벨이 없다 — 0으로 못 박아 엔진과 같은 뜻으로 보낸다.
      next.cube = { name: NO_CUBE, level: 0 };
      commit(next);
      return;
    }
    next.cube = { name: cubeSelect.value as CubeName, level: current.cube!.level || 15 };
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
  const level = noCube ? undefined : cubeMeta.levels[String(current.cube.level)];
  const cubeSummary = document.createElement('p');
  cubeSummary.className = 'cube-summary';
  if (noCube) {
    cubeSummary.textContent = '큐브를 끼지 않습니다 — 큐브의 스탯도, 우월 코드 효과도 붙지 않습니다.';
  } else if (level) {
    const effect = cubeMeta.template.replace('{0}', String(level.effect));
    cubeSummary.textContent = `공격 ${level.atk.toLocaleString('en-US')} · 방어 ${level.def.toLocaleString('en-US')} · `
      + `체력 ${level.hp.toLocaleString('en-US')} · ${effect} · 우월 코드 ${level.commonElement}%`;
  }
  cubeBox.append(cubeHeading, cubeControls, cubeSummary);
  // 고유 스킬이 계산에 안 들어가는 큐브는 그 사실을 숨기지 않는다. 스탯은 붙으므로
  // 선택 자체는 의미가 있고, 표시된 효과 수치만 결과에 반영되지 않는다.
  if (!noCube && cubeMeta.unsupported) {
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
  recommendation.textContent = recommendedControlText(defaults, squad);

  // 조합으로 붙는 컨트롤은 아무도 켠 적이 없는데 걸린다 — 왜 걸리는지 바로 아래 적는다.
  const ruleNotes = document.createElement('div');
  ruleNotes.className = 'control-rules';
  for (const note of controlRuleNotes(defaults, squad)) {
    const row = document.createElement('p');
    row.className = note.active ? 'control-rule is-on' : 'control-rule';
    row.dataset.controlRule = note.active ? 'on' : 'off';
    const head = document.createElement('b');
    head.textContent = note.headline;
    row.append(head);
    if (note.help) {
      const why = document.createElement('span');
      why.textContent = note.help;
      row.append(why);
    }
    ruleNotes.append(row);
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
  // 컨트롤은 창으로 띄우지 않고 **카드에서 그 자리에 펼친다**. 창을 열면 편성이
  // 가려지는데, 컨트롤은 옆 사람 것을 보며 정하는 설정이라 그 대가가 크다.
  // 대신 접힌 칩에 지금 상태를 적어 두어, 열지 않고도 읽히게 한다.
  const controlChip = document.createElement('button');
  controlChip.type = 'button';
  controlChip.className = 'control-chip';
  controlChip.dataset.controlOpen = '';
  controlChip.setAttribute('aria-expanded', String(controlWasOpen));
  const chipGear = document.createElement('span');
  chipGear.className = 'control-chip-gear';
  chipGear.setAttribute('aria-hidden', 'true');
  chipGear.textContent = '⚙';
  const chipText = document.createElement('span');
  chipText.className = 'control-chip-text';
  paintControlChip = () => {
    chipText.textContent = controlChipText(current);
    chipText.title = `컨트롤 · 버스트 — ${chipText.textContent}`;
  };
  paintControlChip();
  const chipCaret = document.createElement('span');
  chipCaret.className = 'control-chip-caret';
  chipCaret.textContent = controlWasOpen ? '▴' : '▾';
  controlChip.append(chipGear, chipText, chipCaret);

  const controlPanel = document.createElement('div');
  controlPanel.className = 'control-panel';
  controlPanel.dataset.controlPanel = '';
  controlPanel.hidden = !controlWasOpen;
  controlPanel.append(controlMode, recommendation, ruleNotes, controlGrid,
    foldedNote('동시 컨트롤 주의', controlWarning, 'control-warning'), burstEditor);
  controlChip.addEventListener('click', () => {
    const next = controlChip.getAttribute('aria-expanded') !== 'true';
    controlChip.setAttribute('aria-expanded', String(next));
    controlPanel.hidden = !next;
    chipCaret.textContent = next ? '▴' : '▾';
  });
  controlEditor.append(controlChip, controlPanel);
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
  // 하나 추가했다고 검색어까지 지우면 둘째 줄부터 매번 다시 쳐야 한다.
  search.value = searchWas;
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
  const bodyFold = panelOpener('돌파 · 스킬 · 오버로드 · 큐브', 'settings', '수치 설정');
  bodyFold.panel.append(body);
  container.append(bodyFold.head, bodyFold.panel, controlEditor);
  lastPanels.set(container, [bodyFold.panel]);
}
