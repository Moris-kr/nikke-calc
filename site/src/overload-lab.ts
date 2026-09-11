/**
 * 오버효율 — 오버로드 옵션 두 벌을 같은 자리에 놓고 견준다.
 *
 * 「4우2공과 4우2장 중 뭐가 나은가」는 계산기로도 잴 수 있다. 다섯 덱에 같은 니케를
 * 세우고 오버로드만 달리 잡으면 된다 — 다만 그러자면 편성 다섯 번, 오버로드 스물네 줄을
 * 손으로 넣어야 한다. 여기서는 **고르는 것이 옵션뿐**이다: 재는 니케와 옵션 두 벌.
 *
 * 정하고 들어가는 것 두 가지
 * -------------------------
 * * **줄은 전부 9단계다.** 오버효율은 「이 옵션에 줄을 몇 개 쓰느냐」의 문제라, 단계까지
 *   섞으면 무엇 때문에 갈렸는지 읽히지 않는다. 9는 흔히 맞춰 두는 단계다.
 * * **나머지 자리는 버프를 안 주는 니케로 채운다**(짬통덱). 아군 버프가 끼면 그 버프의
 *   배율까지 함께 재게 되어 옵션 차이가 부풀거나 묻힌다. 실제 조합에서 재고 싶으면
 *   「커스텀덱」으로 직접 세우면 된다.
 *
 * 전투 조건(시간·코드·코어…)은 **계산기 화면의 지금 값**을 그대로 쓴다 — 여기에 조건을
 * 한 벌 더 두면 둘이 어긋나는 순간 어느 쪽으로 잰 값인지 알 수 없게 된다.
 */

import { overloadTotals, OVERLOAD_LINES_PER_PART } from './character-settings';
import { buildIndex, filterByQuery } from './nikke-search';
import { t } from './i18n';
import type {
  CharacterMeta, CharacterOverrides, EquipPart, OverloadLine, OverloadLines,
  SettingsCatalog, SimulationResult,
} from './types';

/** 오버로드 부위. `character-settings`와 같은 차례다. */
const PARTS: EquipPart[] = ['머리', '몸통', '팔', '다리'];

/** 한 니케가 가질 수 있는 줄 수 — 부위 넷 × 세 줄. */
export const MAX_LINES = PARTS.length * OVERLOAD_LINES_PER_PART;

/** 견주는 줄의 단계. 사람이 고르지 않는다(§정하고 들어가는 것). */
export const LAB_LEVEL = 9;

/**
 * 나머지 자리를 채우는 니케. **아군에게 버프를 주지 않는 셋**을 버스트 단계별로 고른다 —
 * 버프가 끼면 옵션 차이가 그 버프의 배율만큼 부풀거나 묻힌다. 버스트는 돌아야 하므로
 * 1·2·3 단계를 하나씩 세운다.
 */
export const JUNK_FILLER = ['리틀 머메이드', '그레이브', '라피'];

/** 옵션 한 줄묶음 — 「우월 코드 4줄」처럼 무엇을 몇 줄. */
export interface OptionPick {
  option: string;
  count: number;
}

export type FillerKind = 'junk' | 'custom';

/** 한 판을 정하는 값 전부. 화면이 이 모양 하나를 들고 다닌다. */
export interface LabSetup {
  /** 재는 니케. 한 명이거나, 세트로 두 명. */
  measured: string[];
  filler: FillerKind;
  /** 커스텀덱일 때 나머지 자리. 빈 문자열은 빈 칸이다. */
  custom: string[];
  setA: OptionPick[];
  setB: OptionPick[];
}

export const emptySetup = (): LabSetup => ({
  measured: [],
  filler: 'junk',
  custom: ['', '', '', ''],
  setA: [],
  setB: [],
});

/** 고른 줄 수의 합. 열두 줄을 넘게 고를 수는 없다. */
export const pickedLines = (picks: OptionPick[]): number =>
  picks.reduce((sum, pick) => sum + (pick.option ? Math.max(0, pick.count) : 0), 0);

/**
 * 옵션 묶음 → 부위별 줄.
 *
 * 어느 부위에 꽂히는지는 계산에 영향이 없다(엔진이 받는 것은 옵션별 합계다) — 앞에서부터
 * 차곡차곡 채운다. 열두 줄을 넘는 몫은 **버린다**: 넣을 자리가 없는 줄을 조용히 합계에만
 * 더하면 화면이 「12줄」이라고 적어 두고 실제로는 더 센 값으로 계산하게 된다.
 */
export function labLines(picks: OptionPick[], level = LAB_LEVEL): OverloadLines {
  const flat: OverloadLine[] = [];
  for (const pick of picks) {
    if (!pick.option) continue;
    for (let i = 0; i < Math.max(0, Math.trunc(pick.count)); i += 1) {
      if (flat.length >= MAX_LINES) break;
      flat.push({ option: pick.option, level });
    }
  }
  const lines: OverloadLines = {};
  for (const [index, part] of PARTS.entries()) {
    const rows = flat.slice(index * OVERLOAD_LINES_PER_PART, (index + 1) * OVERLOAD_LINES_PER_PART);
    if (rows.length > 0) lines[part] = rows;
  }
  return lines;
}

/** 그 묶음을 엔진이 받는 모양(옵션별 합계)까지 펼친 것. */
export function labOverrides(
  base: CharacterOverrides | undefined,
  picks: OptionPick[],
  steps: Record<string, number[]>,
): CharacterOverrides {
  const lines = labLines(picks);
  const full = {} as Record<EquipPart, OverloadLine[]>;
  for (const part of PARTS) {
    full[part] = Array.from({ length: OVERLOAD_LINES_PER_PART }, (_, index) =>
      lines[part]?.[index] ?? { option: '', level: LAB_LEVEL });
  }
  return {
    ...(base ?? {}),
    overload: overloadTotals(full, steps),
    overloadLines: lines,
  };
}

/**
 * 재는 니케 + 나머지 자리 → 편성 다섯 칸.
 *
 * 짬통덱은 재는 니케와 겹치지 않게 채운다 — 같은 니케를 두 번 세우면 계산이 막힌다.
 */
export function labSquad(setup: LabSetup): string[] {
  const measured = setup.measured.filter(Boolean);
  const rest = setup.filler === 'junk'
    ? JUNK_FILLER.filter((name) => !measured.includes(name))
    : setup.custom.filter((name) => name && !measured.includes(name));
  return [...measured, ...rest].slice(0, 5);
}

/** 견줄 준비가 됐나. 안 됐으면 무엇이 모자란지 한 줄로 알린다. */
export function labProblem(setup: LabSetup): string | null {
  if (setup.measured.filter(Boolean).length === 0) return t('재는 니케를 골라 주세요.');
  if (pickedLines(setup.setA) === 0 && pickedLines(setup.setB) === 0) {
    return t('견줄 오버로드 옵션을 한 벌 이상 골라 주세요.');
  }
  for (const [label, picks] of [['A', setup.setA], ['B', setup.setB]] as const) {
    if (pickedLines(picks) > MAX_LINES) {
      return t('{label} 묶음이 {max}줄을 넘습니다 ({used}줄).',
        { label, max: MAX_LINES, used: pickedLines(picks) });
    }
  }
  if (labSquad(setup).length === 0) return t('편성이 비었습니다.');
  return null;
}

/** 한쪽 결과. 재는 니케의 딜과 스쿼드 총딜을 함께 든다. */
export interface LabSide {
  picks: OptionPick[];
  damage: number;
  squadTotal: number;
}

export interface LabOutcome {
  a: LabSide;
  b: LabSide;
}

/** A가 B보다 몇 % 높은가. B가 0이면 견줄 것이 없다. */
export const labGain = (outcome: LabOutcome): number =>
  (outcome.b.damage > 0 ? (outcome.a.damage / outcome.b.damage - 1) * 100 : 0);

/**
 * 줄 하나가 벌어 준 몫(%). 두 묶음의 줄 수가 다를 때 «어느 쪽이 더 효율적인가»를
 * 재는 눈금이다 — 줄 수가 같으면 0으로 나눌 일이 없도록 그냥 총 차이를 돌려준다.
 */
export function labPerLine(outcome: LabOutcome): number | null {
  const gap = pickedLines(outcome.a.picks) - pickedLines(outcome.b.picks);
  if (gap === 0) return null;
  return labGain(outcome) / gap;
}

export interface LabDeps {
  catalog: CharacterMeta[];
  settings: SettingsCatalog;
  /** 이 편성을 지금 전투 조건으로 한 판 돌린다. */
  run(squad: string[], characters: Record<string, CharacterOverrides>): Promise<SimulationResult>;
  /** 그 니케에 이미 잡혀 있는 설정(로스터·덱). 오버로드만 갈아 끼운다. */
  baseOf(name: string): CharacterOverrides | undefined;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const DAMAGE = new Intl.NumberFormat('ko-KR');

/** 억 단위로 접어 읽기 쉽게. 결과 판과 같은 규칙이다. */
const short = (value: number): string =>
  (value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}억` : DAMAGE.format(Math.round(value)));

export interface LabHandle {
  /** 화면을 다시 그린다. 니케 목록·설정이 밖에서 바뀌었을 때 부른다. */
  refresh(): void;
}

export function mountOverloadLab(host: HTMLElement, deps: LabDeps): LabHandle {
  const setup = emptySetup();
  let running = false;
  let outcome: LabOutcome | null = null;
  let message = '';

  const optionKeys = Object.keys(deps.settings.overloadSteps ?? {});
  const optionLabel = (key: string) => deps.settings.overloadFields?.[key]?.label ?? key;
  const names = deps.catalog.map((char) => char.name);
  const indexOf = (name: string) => {
    const meta = deps.catalog.find((char) => char.name === name);
    return buildIndex(meta ?? ({ name, aliases: [] } as unknown as CharacterMeta));
  };

  /** 니케 하나를 고르는 칸 — 검색과 고르개 한 쌍. 베껴오기와 같은 검색을 쓴다. */
  function nikkePicker(value: string, onPick: (name: string) => void): HTMLElement {
    const wrap = el('div', 'lab-picker');
    const search = el('input', 'lab-search');
    search.type = 'search';
    search.placeholder = t('이름 · 초성');
    const pick = el('select', 'lab-pick');
    pick.dataset.labPick = '';
    const fill = () => {
      const shown = filterByQuery(names, search.value.trim(), indexOf);
      pick.replaceChildren();
      const blank = el('option', '', t('고르기'));
      blank.value = '';
      pick.append(blank);
      for (const name of shown) {
        const option = el('option', '', name);
        option.value = name;
        pick.append(option);
      }
      pick.value = shown.includes(value) ? value : '';
    };
    search.addEventListener('input', fill);
    pick.addEventListener('change', () => onPick(pick.value));
    fill();
    wrap.append(search, pick);
    return wrap;
  }

  /** 옵션 묶음 한 벌을 고치는 판. 줄 수 합계를 그 자리에서 보여 준다. */
  function setEditor(label: string, picks: OptionPick[]): HTMLElement {
    const box = el('div', 'lab-set');
    box.dataset.labSet = label;
    const head = el('div', 'lab-set-head');
    head.append(el('b', '', label));
    const used = pickedLines(picks);
    const count = el('span', used > MAX_LINES ? 'lab-set-count is-over' : 'lab-set-count',
      t('{used} / {max}줄', { used, max: MAX_LINES }));
    head.append(count);
    box.append(head);

    for (const [index, pick] of picks.entries()) {
      const row = el('div', 'lab-set-row');
      const option = el('select', '');
      option.dataset.labOption = String(index);
      for (const key of optionKeys) {
        const item = el('option', '', optionLabel(key));
        item.value = key;
        option.append(item);
      }
      option.value = pick.option;
      option.addEventListener('change', () => { pick.option = option.value; render(); });
      const lines = el('input', 'lab-count');
      lines.type = 'number';
      lines.min = '1';
      lines.max = String(MAX_LINES);
      lines.step = '1';
      lines.value = String(pick.count);
      lines.dataset.labCount = String(index);
      lines.addEventListener('change', () => {
        pick.count = Math.max(1, Math.min(MAX_LINES, Math.trunc(Number(lines.value) || 1)));
        render();
      });
      const drop = el('button', 'lab-drop', '✕');
      drop.type = 'button';
      drop.title = t('이 줄묶음 빼기');
      drop.addEventListener('click', () => { picks.splice(index, 1); render(); });
      row.append(option, lines, el('span', 'lab-unit', t('줄')), drop);
      box.append(row);
    }

    const add = el('button', 'lab-add', t('+ 옵션'));
    add.type = 'button';
    add.dataset.labAdd = label;
    add.addEventListener('click', () => {
      picks.push({ option: optionKeys[0] ?? '', count: 1 });
      render();
    });
    box.append(add);
    if (picks.length === 0) {
      box.append(el('p', 'field-note', t('비워 두면 0줄(오버로드 없음)과 견줍니다.')));
    }
    return box;
  }

  async function run() {
    const problem = labProblem(setup);
    if (problem) { message = problem; render(); return; }
    running = true;
    message = t('견주는 중…');
    render();
    try {
      const squad = labSquad(setup);
      const steps = deps.settings.overloadSteps ?? {};
      const sideOf = async (picks: OptionPick[]): Promise<LabSide> => {
        const characters: Record<string, CharacterOverrides> = {};
        for (const name of squad) {
          const base = deps.baseOf(name);
          if (setup.measured.includes(name)) {
            characters[name] = labOverrides(base, picks, steps);
          } else if (base) {
            characters[name] = base;
          }
        }
        const result = await deps.run(squad, characters);
        const damage = setup.measured
          .reduce((sum, name) => sum + (result.charTotals?.[name] ?? 0), 0);
        return { picks: picks.map((pick) => ({ ...pick })), damage, squadTotal: result.squadTotal };
      };
      const a = await sideOf(setup.setA);
      const b = await sideOf(setup.setB);
      outcome = { a, b };
      message = '';
    } catch (error) {
      outcome = null;
      message = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
      render();
    }
  }

  function renderOutcome(): HTMLElement {
    const box = el('div', 'lab-result');
    box.dataset.labResult = '';
    if (!outcome) return box;
    const gain = labGain(outcome);
    const perLine = labPerLine(outcome);
    const rows: Array<[string, LabSide]> = [['A', outcome.a], ['B', outcome.b]];
    for (const [label, side] of rows) {
      const row = el('div', 'lab-result-row');
      row.dataset.labResultRow = label;
      const what = pickedLines(side.picks) === 0
        ? t('0줄')
        : side.picks.filter((pick) => pick.option)
          .map((pick) => `${optionLabel(pick.option)} ${pick.count}`).join(' · ');
      row.append(el('b', '', label), el('span', 'lab-result-what', what));
      row.append(el('strong', '', short(side.damage)));
      row.append(el('small', '', t('스쿼드 {n}', { n: short(side.squadTotal) })));
      box.append(row);
    }
    const verdict = el('p', 'lab-verdict');
    verdict.dataset.labVerdict = '';
    const winner = gain >= 0 ? 'A' : 'B';
    verdict.textContent = gain === 0
      ? t('두 묶음이 같습니다.')
      : t('{winner}가 {pct}% 높습니다', { winner, pct: Math.abs(gain).toFixed(2) });
    box.append(verdict);
    if (perLine !== null) {
      box.append(el('p', 'field-note',
        t('줄 수가 달라 한 줄당 {pct}%로 환산됩니다.', { pct: perLine.toFixed(2) })));
    }
    return box;
  }

  function render() {
    host.replaceChildren();
    const head = el('div', 'section-heading compact');
    head.append(el('h2', '', t('오버효율')));
    host.append(head);
    host.append(el('p', 'links-lede', t('오버로드 옵션 두 벌을 같은 자리에 놓고 견줍니다. 줄은 전부 9단계이고, 전투 조건은 계산기 화면에 잡아 둔 값을 그대로 씁니다.')));

    // ── 재는 니케 ─────────────────────────────────────────────────────────
    const who = el('section', 'lab-block');
    who.append(el('h3', 'lab-title', t('재는 니케')));
    const first = setup.measured[0] ?? '';
    who.append(nikkePicker(first, (name) => {
      setup.measured[0] = name;
      setup.measured = setup.measured.filter(Boolean);
      render();
    }));
    const pair = el('label', 'inline-check');
    const pairBox = el('input', '');
    pairBox.type = 'checkbox';
    pairBox.dataset.labPair = '';
    pairBox.checked = setup.measured.length > 1;
    pairBox.addEventListener('change', () => {
      if (pairBox.checked) setup.measured[1] = setup.measured[1] ?? '';
      else setup.measured = setup.measured.slice(0, 1);
      render();
    });
    pair.append(pairBox, el('span', '', t('세트로 한 명 더 (퀸 · 유키코처럼 둘이 한 벌일 때)')));
    who.append(pair);
    if (pairBox.checked) {
      who.append(nikkePicker(setup.measured[1] ?? '', (name) => {
        setup.measured[1] = name;
        setup.measured = setup.measured.filter(Boolean);
        render();
      }));
    }
    host.append(who);

    // ── 나머지 자리 ───────────────────────────────────────────────────────
    const rest = el('section', 'lab-block');
    rest.append(el('h3', 'lab-title', t('나머지 자리')));
    for (const kind of ['junk', 'custom'] as FillerKind[]) {
      const row = el('label', 'inline-check');
      const radio = el('input', '');
      radio.type = 'radio';
      radio.name = 'lab-filler';
      radio.value = kind;
      radio.checked = setup.filler === kind;
      radio.dataset.labFiller = kind;
      radio.addEventListener('change', () => { setup.filler = kind; render(); });
      row.append(radio, el('span', '', kind === 'junk'
        ? t('짬통덱 ({who})', { who: JUNK_FILLER.join(' · ') })
        : t('커스텀덱 — 직접 세우기')));
      rest.append(row);
    }
    if (setup.filler === 'custom') {
      const grid = el('div', 'lab-custom');
      for (let slot = 0; slot < 4; slot += 1) {
        grid.append(nikkePicker(setup.custom[slot] ?? '', (name) => {
          setup.custom[slot] = name;
          render();
        }));
      }
      rest.append(grid);
    } else {
      rest.append(el('p', 'field-note', t('아군에게 버프를 주지 않는 셋입니다 — 옵션 차이만 남기려는 것입니다.')));
    }
    host.append(rest);

    // ── 옵션 두 벌 ────────────────────────────────────────────────────────
    const sets = el('section', 'lab-block');
    sets.append(el('h3', 'lab-title', t('견줄 오버로드 옵션')));
    const grid = el('div', 'lab-sets');
    grid.append(setEditor('A', setup.setA), setEditor('B', setup.setB));
    sets.append(grid);
    host.append(sets);

    // ── 실행 ──────────────────────────────────────────────────────────────
    const bar = el('div', 'lab-run');
    const go = el('button', 'calculate-button', t('견주기'));
    go.type = 'button';
    go.dataset.labRun = '';
    go.disabled = running;
    go.addEventListener('click', () => { void run(); });
    bar.append(go);
    const squad = labSquad(setup);
    if (squad.length > 0) {
      bar.append(el('span', 'lab-squad', squad.join(' · ')));
    }
    host.append(bar);
    if (message) {
      const note = el('p', 'status', message);
      note.dataset.labMessage = '';
      host.append(note);
    }
    host.append(renderOutcome());
  }

  render();
  return { refresh: render };
}
