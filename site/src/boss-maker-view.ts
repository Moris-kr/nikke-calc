/**
 * 「보스 메이커」 화면. 모양을 그리는 무대(SVG), 조건 판, 타임라인 띠 셋으로 나뉜다.
 *
 * 그리는 규칙과 셈은 전부 `boss-maker.ts`에 있고 여기서는 **손과 눈**만 맡는다 —
 * 무엇을 눌렀는지, 어디로 끌었는지, 무엇을 그릴지.
 *
 * 무대는 캔버스가 아니라 **SVG**다. 도형 하나하나가 DOM 요소라 고르기·끌기가 이벤트로
 * 그대로 풀리고, 확대해도 뭉개지지 않는다(타임라인 그림은 초당 수천 점을 찍어야 해서
 * 캔버스지만, 여기는 도형이 수십 개다).
 */

import {
  aimPoint, coreHitChance, DEFAULT_CORE_PX, derivedEnemy, distance, ELEMENT_COLOR, emptyDesign,
  hitTest, newId, parseDesign, partBreaks, partsInBlast, phaseAt, spreadRadius, visibleAt,
  type BossDesign, type BossPart, type BossShape, type ShapeKind,
} from './boss-maker';
import type {
  BattleSettings, CharacterMeta, CharacterOverrides, ElementCode, ShotTrack,
  SettingsCatalog, SimulationRequest, SimulationResult,
} from './types';
import type { StorageLike } from './cache';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BossMakerDeps {
  settings: SettingsCatalog;
  catalog: CharacterMeta[];
  simulate: (request: SimulationRequest) => Promise<SimulationResult>;
  /** 지금 보고 있는 덱의 편성 */
  currentSquad: () => string[];
  /** 그 덱의 캐릭터 설정 — 시뮬 요청에 그대로 실린다 */
  currentCharacters: () => Record<string, CharacterOverrides>;
  currentBattle: () => BattleSettings;
  /** 만든 보스를 전투 조건에 반영한다 */
  applyBattle: (battle: BattleSettings) => void;
  imageOf: (name: string) => string | undefined;
  storage: () => StorageLike | null;
}

export interface BossMakerHandle {
  open: () => void;
  close: () => void;
}

const DESIGN_KEY = 'nikke-boss-design-v1';
/** 폭발 반경 기본값(px). 인게임 값이 아니라 «눈으로 맞춰 보는» 자리라 넉넉히 둔다. */
const DEFAULT_BLAST = 90;
/** 이 폭보다 좁으면 구성은 못 하게 막는다 — 무대와 판이 함께 서지 못한다. */
const MIN_WIDTH = 1024;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG_NS, tag);

const attrs = (node: Element, values: Record<string, string | number>) => {
  for (const [key, value] of Object.entries(values)) node.setAttribute(key, String(value));
};

const round = (value: number, digits = 1): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** 도형 하나를 SVG 요소로. 삼각형만 점 셋으로 그린다. */
function shapeNode(shape: BossShape): SVGElement {
  if (shape.kind === 'circle') {
    const node = svgEl('ellipse');
    attrs(node, { cx: shape.x, cy: shape.y, rx: shape.w / 2, ry: shape.h / 2 });
    return node;
  }
  if (shape.kind === 'rect') {
    const node = svgEl('rect');
    attrs(node, {
      x: shape.x - shape.w / 2, y: shape.y - shape.h / 2, width: shape.w, height: shape.h, rx: 4,
    });
    return node;
  }
  const node = svgEl('polygon');
  const halfW = shape.w / 2;
  const halfH = shape.h / 2;
  attrs(node, {
    points: [
      `${shape.x},${shape.y - halfH}`,
      `${shape.x + halfW},${shape.y + halfH}`,
      `${shape.x - halfW},${shape.y + halfH}`,
    ].join(' '),
  });
  return node;
}

export function mountBossMaker(host: HTMLElement, deps: BossMakerDeps): BossMakerHandle {
  let design: BossDesign = parseDesign(readSaved()) ?? emptyDesign();
  let selectedId: string | null = null;
  /** 다음 무대 클릭으로 놓을 것. 없으면 고르기 모드다 */
  let placing: ShapeKind | 'part' | 'core' | 'center' | null = null;
  let shots: ShotTrack | null = null;
  let lastResult: SimulationResult | null = null;
  let cursor = 0;
  let running = false;

  function readSaved(): string | null {
    try {
      return deps.storage()?.getItem(DESIGN_KEY) ?? null;
    } catch {
      return null;
    }
  }
  function save() {
    try {
      deps.storage()?.setItem(DESIGN_KEY, JSON.stringify(design));
    } catch {
      /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */
    }
  }

  // ── 뼈대 ──────────────────────────────────────────────────────────────────
  host.classList.add('boss-maker');
  host.hidden = true;
  host.innerHTML = `
    <div class="bm-frame" role="dialog" aria-label="보스 메이커">
      <header class="bm-top">
        <div class="bm-title">
          <b>보스 메이커</b>
          <input type="text" class="bm-name" data-bm-name maxlength="24" placeholder="보스 이름" />
        </div>
        <div class="bm-top-actions">
          <button type="button" class="bm-btn" data-bm-apply>전투 조건에 반영</button>
          <button type="button" class="bm-btn ghost" data-bm-reset>새로 만들기</button>
          <button type="button" class="bm-close" data-bm-close aria-label="닫기">✕</button>
        </div>
      </header>

      <p class="bm-narrow" data-bm-narrow hidden>
        <b>구성은 PC에서만 할 수 있습니다.</b> 무대와 설정 판이 나란히 서야 해서 좁은 화면에서는
        도형을 놓을 수 없습니다 — <b>계산은 모바일에서도 그대로 됩니다.</b> 만들어 둔 보스를
        전투 조건에 반영해 두면 어느 기기에서든 그 조건으로 계산합니다.
      </p>

      <div class="bm-body">
        <aside class="bm-tools">
          <div class="bm-tool-group">
            <span class="bm-tool-label">모양</span>
            <button type="button" class="bm-tool" data-bm-place="circle" title="원 놓기"><i class="bm-ico circle"></i>원</button>
            <button type="button" class="bm-tool" data-bm-place="rect" title="네모 놓기"><i class="bm-ico rect"></i>네모</button>
            <button type="button" class="bm-tool" data-bm-place="triangle" title="삼각형 놓기"><i class="bm-ico tri"></i>삼각형</button>
          </div>
          <div class="bm-tool-group">
            <span class="bm-tool-label">부위</span>
            <button type="button" class="bm-tool" data-bm-place="part" title="파츠 놓기">파츠</button>
            <button type="button" class="bm-tool" data-bm-place="core" title="코어 자리 찍기">코어</button>
            <button type="button" class="bm-tool" data-bm-place="center" title="조준 기준이 되는 보스 중앙 찍기">중앙</button>
          </div>
          <div class="bm-tool-group">
            <span class="bm-tool-label">밑그림</span>
            <label class="bm-tool file">불러오기<input type="file" accept="image/*" data-bm-image hidden /></label>
            <label class="bm-slider">투명도<input type="range" min="5" max="100" value="45" data-bm-image-opacity /></label>
            <label class="bm-slider">크기<input type="range" min="20" max="200" value="100" data-bm-image-scale /></label>
            <button type="button" class="bm-tool ghost" data-bm-image-clear>밑그림 지우기</button>
          </div>
          <p class="bm-hint" data-bm-hint></p>
        </aside>

        <div class="bm-stage-wrap">
          <div class="bm-stage-head">
            <span class="bm-stage-note" data-bm-center-warn hidden>
              <b>보스 중앙을 찍어 주세요.</b> 코어가 없는 보스는 이 점을 겨냥합니다.
            </span>
            <span class="bm-stage-meta" data-bm-stage-meta></span>
          </div>
          <svg class="bm-stage" data-bm-stage xmlns="${SVG_NS}"></svg>
          <div class="bm-scrub" data-bm-scrub hidden>
            <input type="range" min="0" max="100" value="0" step="1" data-bm-cursor />
            <output data-bm-cursor-label>0.0초</output>
          </div>
        </div>

        <aside class="bm-side">
          <section class="bm-card" data-bm-inspector></section>
          <section class="bm-card" data-bm-battle></section>
        </aside>
      </div>

      <footer class="bm-timeline">
        <div class="bm-timeline-head">
          <button type="button" class="bm-btn accent" data-bm-run>현재 덱으로 타임라인 구성</button>
          <span class="bm-timeline-note" data-bm-run-note>편성한 덱으로 한 판 돌려, 누가 언제 어디에 쏘는지 이 자리에 폅니다.</span>
        </div>
        <div class="bm-tracks" data-bm-tracks></div>
      </footer>
    </div>
  `;

  const q = <T extends Element>(selector: string): T => host.querySelector<T>(selector)!;
  const stage = q<SVGSVGElement>('[data-bm-stage]');
  const inspector = q<HTMLElement>('[data-bm-inspector]');
  const battlePane = q<HTMLElement>('[data-bm-battle]');
  const tracks = q<HTMLElement>('[data-bm-tracks]');
  const hint = q<HTMLElement>('[data-bm-hint]');
  const stageMeta = q<HTMLElement>('[data-bm-stage-meta]');
  const centerWarn = q<HTMLElement>('[data-bm-center-warn]');
  const nameInput = q<HTMLInputElement>('[data-bm-name]');
  const narrow = q<HTMLElement>('[data-bm-narrow]');
  const scrub = q<HTMLElement>('[data-bm-scrub]');
  const cursorInput = q<HTMLInputElement>('[data-bm-cursor]');
  const cursorLabel = q<HTMLOutputElement>('[data-bm-cursor-label]');
  const runNote = q<HTMLElement>('[data-bm-run-note]');

  const accuracy = deps.settings.accuracy;
  const weaponOf = (name: string) => deps.settings.characters[name]?.weaponType ?? 'AR';
  const allItems = (): BossShape[] => [...design.shapes, ...design.parts];
  const findItem = (id: string | null): BossShape | undefined =>
    allItems().find((item) => item.id === id);
  const isPart = (id: string): boolean => design.parts.some((part) => part.id === id);

  // ── 무대 그리기 ───────────────────────────────────────────────────────────

  function drawStage() {
    stage.setAttribute('viewBox', `0 0 ${design.canvas.w} ${design.canvas.h}`);
    stage.replaceChildren();

    const at = shots ? cursor : 0;
    const battle = deps.currentBattle();
    const phase = phaseAt(at, battle.immuneWindows, battle.elementWindows);

    // 밑그림 — 도형 아래에 깔고 흐리게 둔다.
    if (design.image) {
      const image = svgEl('image');
      attrs(image, {
        href: design.image.src, x: design.image.x, y: design.image.y,
        width: design.image.w, height: design.image.h,
        opacity: design.image.opacity, preserveAspectRatio: 'xMidYMid meet',
      });
      stage.append(image);
    }

    // 이름은 `bm-figure`다 — 바깥 레이아웃 격자가 이미 `.bm-body`라, 같은 이름을 쓰면
    // 무대의 도형 묶음이 그 격자 규칙까지 물려받는다.
    const body = svgEl('g');
    body.setAttribute('class', phase.immune ? 'bm-figure is-gone' : 'bm-figure');
    for (const shape of visibleAt(design.shapes, at)) {
      const node = shapeNode(shape);
      node.setAttribute('class', `bm-shape${selectedId === shape.id ? ' is-on' : ''}`);
      node.setAttribute('fill', shape.color);
      node.dataset.bmItem = shape.id;
      body.append(node);
    }
    for (const part of visibleAt(design.parts, at)) {
      const node = shapeNode(part);
      node.setAttribute('class', `bm-part${selectedId === part.id ? ' is-on' : ''}`);
      node.dataset.bmItem = part.id;
      body.append(node);
      const label = svgEl('text');
      attrs(label, { x: part.x, y: part.y - part.h / 2 - 6, 'text-anchor': 'middle' });
      label.setAttribute('class', 'bm-part-label');
      label.textContent = part.name;
      body.append(label);
    }
    stage.append(body);

    // 속저 방어막 — 그 코드 색으로 보스를 덮는다.
    if (phase.shield) {
      const aim = aimPoint(design);
      const shield = svgEl('circle');
      const radius = Math.max(design.canvas.w, design.canvas.h) * 0.32;
      attrs(shield, {
        cx: aim?.x ?? design.canvas.w / 2, cy: aim?.y ?? design.canvas.h / 2, r: radius,
      });
      shield.setAttribute('class', 'bm-shield');
      shield.setAttribute('fill', ELEMENT_COLOR[phase.shield] ?? '#8ab');
      stage.append(shield);
    }

    // 코어와 중앙.
    if (design.core) {
      const core = svgEl('circle');
      attrs(core, { cx: design.core.x, cy: design.core.y, r: design.core.d / 2 });
      core.setAttribute('class', `bm-core${selectedId === 'core' ? ' is-on' : ''}`);
      core.dataset.bmItem = 'core';
      stage.append(core);
    }
    if (design.center) {
      const mark = svgEl('g');
      mark.setAttribute('class', `bm-center${selectedId === 'center' ? ' is-on' : ''}`);
      mark.dataset.bmItem = 'center';
      const cross: Array<[number, number, number, number]> = [
        [design.center.x - 12, design.center.y, design.center.x + 12, design.center.y],
        [design.center.x, design.center.y - 12, design.center.x, design.center.y + 12],
      ];
      for (const [x1, y1, x2, y2] of cross) {
        const line = svgEl('line');
        attrs(line, { x1, y1, x2, y2 });
        mark.append(line);
      }
      stage.append(mark);
    }

    drawAim(phase.immune);
    drawHandles();
    updateStageMeta();
  }

  /** 니케마다 탄착군 원과 폭발 원을 겹쳐 그린다. 조준점은 코어 → 중앙 차례다. */
  function drawAim(hidden: boolean) {
    const aim = aimPoint(design);
    centerWarn.hidden = !(aim === null || (design.core === null && design.center === null));
    if (!aim || hidden) return;

    const squad = deps.currentSquad().filter(Boolean);
    const group = svgEl('g');
    group.setAttribute('class', 'bm-aim');
    for (const [index, name] of squad.entries()) {
      const weapon = weaponOf(name);
      const radius = spreadRadius(accuracy, weapon, 0);
      const ring = svgEl('circle');
      attrs(ring, { cx: aim.x, cy: aim.y, r: radius });
      ring.setAttribute('class', 'bm-spread');
      ring.setAttribute('style', `--i:${index}`);
      group.append(ring);

      // 폭발 반경 — 참고선이다. 엔진은 폭발 범위를 계산하지 않는다.
      const blast = design.explosion[name];
      if (blast && blast > 0 && firing(name)) {
        const circle = svgEl('circle');
        attrs(circle, { cx: aim.x, cy: aim.y, r: blast });
        circle.setAttribute('class', 'bm-blast');
        group.append(circle);
      }
    }
    stage.append(group);
  }

  /** 지금 커서 자리에서 그 니케가 쏘고 있는가. 트랙이 없으면 늘 참으로 본다. */
  function firing(name: string): boolean {
    if (!shots) return true;
    const row = shots.chars[name];
    if (!row) return false;
    const index = Math.min(shots.buckets - 1, Math.floor(cursor / shots.bucket));
    return (row.normal[index] ?? 0) + (row.skill[index] ?? 0) > 0;
  }

  /** 고른 것 둘레의 손잡이. 오른쪽 아래 하나로 크기를 잡는다. */
  function drawHandles() {
    const item = findItem(selectedId);
    if (!item) return;
    const handle = svgEl('rect');
    attrs(handle, {
      x: item.x + item.w / 2 - 5, y: item.y + item.h / 2 - 5, width: 10, height: 10,
    });
    handle.setAttribute('class', 'bm-handle');
    handle.dataset.bmHandle = item.id;
    stage.append(handle);
  }

  function updateStageMeta() {
    const parts = design.parts.length;
    const core = design.core ? `코어 ${Math.round(design.core.d)}px` : '코어 없음';
    const pair = design.parts.length >= 2
      ? ` · 파츠 최소 간격 ${round(closestPair())}px` : '';
    stageMeta.textContent = `${design.canvas.w}×${design.canvas.h}px · ${core} · 파츠 ${parts}개${pair}`;
  }

  function closestPair(): number {
    let best = Infinity;
    for (let i = 0; i < design.parts.length; i += 1) {
      for (let j = i + 1; j < design.parts.length; j += 1) {
        best = Math.min(best, distance(design.parts[i]!, design.parts[j]!));
      }
    }
    return best === Infinity ? 0 : best;
  }

  // ── 무대 조작 ─────────────────────────────────────────────────────────────

  /**
   * 화면 좌표 → 무대 좌표.
   *
   * 무대는 칸을 꽉 채우지 않고 **비율을 지켜 가운데 놓인다**(`xMidYMid meet`). 그래서
   * 위아래나 좌우에 여백이 생기고, 상자 크기로 단순히 비례를 잡으면 그 여백만큼 어긋난다.
   * SVG가 들고 있는 변환 행렬을 그대로 뒤집어 쓰면 여백까지 셈해 준다.
   */
  const stagePoint = (event: PointerEvent | MouseEvent): { x: number; y: number } => {
    const ctm = stage.getScreenCTM?.();
    if (ctm) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return { x: point.x, y: point.y };
    }
    // 행렬을 못 받는 환경(시험용 DOM 등)에서는 여백을 손으로 셈한다.
    const box = stage.getBoundingClientRect();
    const scale = Math.min(box.width / design.canvas.w, box.height / design.canvas.h) || 1;
    return {
      x: (event.clientX - box.left - (box.width - design.canvas.w * scale) / 2) / scale,
      y: (event.clientY - box.top - (box.height - design.canvas.h * scale) / 2) / scale,
    };
  };

  const setHint = (text: string) => { hint.textContent = text; };

  function place(kind: NonNullable<typeof placing>, at: { x: number; y: number }) {
    if (kind === 'core') {
      design.core = { x: at.x, y: at.y, d: design.core?.d ?? DEFAULT_CORE_PX };
      selectedId = 'core';
    } else if (kind === 'center') {
      design.center = { x: at.x, y: at.y };
      selectedId = 'center';
    } else if (kind === 'part') {
      const part: BossPart = {
        id: newId('part'), kind: 'rect', x: at.x, y: at.y, w: 90, h: 60, rotation: 0,
        color: '#ffb347', name: `파츠 ${design.parts.length + 1}`, hp: 5_000_000,
      };
      design.parts.push(part);
      selectedId = part.id;
    } else {
      const shape: BossShape = {
        id: newId('shape'), kind, x: at.x, y: at.y, w: 140, h: 140, rotation: 0,
        color: 'rgba(120,150,190,.35)',
      };
      design.shapes.push(shape);
      selectedId = shape.id;
    }
    placing = null;
    for (const button of host.querySelectorAll('[data-bm-place]')) button.classList.remove('is-on');
    setHint('');
    save();
    render();
  }

  stage.addEventListener('pointerdown', (event) => {
    const at = stagePoint(event);
    if (placing) { place(placing, at); return; }

    const target = event.target as SVGElement | null;
    const handleId = target?.dataset?.bmHandle;
    const itemId = target?.dataset?.bmItem;

    if (handleId) {
      const item = findItem(handleId);
      if (!item) return;
      startDrag(event, (point) => {
        item.w = Math.max(12, Math.abs(point.x - item.x) * 2);
        item.h = Math.max(12, Math.abs(point.y - item.y) * 2);
      });
      return;
    }
    if (itemId === 'core' && design.core) {
      selectedId = 'core';
      const core = design.core;
      startDrag(event, (point) => { core.x = point.x; core.y = point.y; });
      render();
      return;
    }
    if (itemId === 'center' && design.center) {
      selectedId = 'center';
      const center = design.center;
      startDrag(event, (point) => { center.x = point.x; center.y = point.y; });
      render();
      return;
    }
    // 도형은 위에 있는 것부터 고른다 — 겹쳐 놓으면 나중에 놓은 것이 위다.
    const items = allItems();
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]!;
      if (!hitTest(item, at.x, at.y)) continue;
      selectedId = item.id;
      const grabX = at.x - item.x;
      const grabY = at.y - item.y;
      startDrag(event, (point) => { item.x = point.x - grabX; item.y = point.y - grabY; });
      render();
      return;
    }
    selectedId = null;
    render();
  });

  function startDrag(event: PointerEvent, move: (point: { x: number; y: number }) => void) {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      move(stagePoint(moveEvent));
      drawStage();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      save();
      render();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-bm-place]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset.bmPlace as NonNullable<typeof placing>;
      const same = placing === kind;
      for (const other of host.querySelectorAll('[data-bm-place]')) other.classList.remove('is-on');
      placing = same ? null : kind;
      if (!same) button.classList.add('is-on');
      setHint(placing ? '무대를 눌러 놓을 자리를 정하세요.' : '');
    });
  }

  // ── 속성 판 ───────────────────────────────────────────────────────────────

  function renderInspector() {
    inspector.replaceChildren();
    inspector.append(el('h3', 'bm-card-title', '선택'));

    if (selectedId === 'core' && design.core) {
      const core = design.core;
      inspector.append(numberRow('코어 직경', core.d, 4, 400, (value) => {
        core.d = value;
      }, 'px'));
      const chance = el('p', 'bm-note');
      const squad = deps.currentSquad().filter(Boolean);
      chance.textContent = squad.length === 0
        ? '편성이 비어 있어 코어 적중률을 낼 수 없습니다.'
        : squad.map((name) =>
          `${name} ${Math.round(coreHitChance(accuracy, weaponOf(name), core.d) * 100)}%`).join(' · ');
      inspector.append(el('p', 'bm-note-head', '코어 적중률 (명중률 0 기준)'), chance);
      inspector.append(deleteRow('코어 지우기', () => { design.core = null; }));
      return;
    }
    if (selectedId === 'center' && design.center) {
      inspector.append(el('p', 'bm-note',
        '코어가 없는 보스는 이 점을 겨냥합니다. 코어가 있으면 코어가 먼저입니다.'));
      inspector.append(deleteRow('중앙 지우기', () => { design.center = null; }));
      return;
    }

    const item = findItem(selectedId);
    if (!item) {
      inspector.append(el('p', 'bm-note',
        '무대에서 도형이나 파츠를 누르면 여기서 값을 고칩니다. 왼쪽 도구로 새로 놓을 수 있습니다.'));
      return;
    }

    if (isPart(item.id)) {
      const part = item as BossPart;
      const name = el('label', 'bm-row');
      name.append(el('span', '', '이름'));
      const nameField = el('input', 'bm-field');
      nameField.type = 'text';
      nameField.value = part.name;
      nameField.maxLength = 16;
      nameField.addEventListener('input', () => { part.name = nameField.value; save(); drawStage(); });
      name.append(nameField);
      inspector.append(name);
      inspector.append(numberRow('파츠 체력', part.hp, 0, 9_999_999_999, (value) => {
        part.hp = value;
      }, ''));
      const breaks = partBreaks([part], squadDps(), deps.currentBattle().duration);
      const at = breaks[0]?.at ?? null;
      inspector.append(el('p', 'bm-note', at === null
        ? '지금 덱의 딜로는 이 전투 안에 깨지지 않습니다.'
        : `지금 덱의 딜(${Math.round(squadDps()).toLocaleString('ko-KR')}/초)이면 약 ${round(at)}초에 깨집니다.`));
    }

    inspector.append(numberRow('가로', item.w, 4, 2000, (value) => { item.w = value; }, 'px'));
    inspector.append(numberRow('세로', item.h, 4, 2000, (value) => { item.h = value; }, 'px'));
    inspector.append(numberRow('기울기', item.rotation, -180, 180, (value) => {
      item.rotation = value;
    }, '°'));
    inspector.append(numberRow('나타남', item.from ?? 0, 0, 600, (value) => {
      if (value > 0) item.from = value; else delete item.from;
    }, '초'));
    inspector.append(numberRow('사라짐', item.to ?? 0, 0, 600, (value) => {
      if (value > 0) item.to = value; else delete item.to;
    }, '초'));

    if (design.parts.length >= 2 && isPart(item.id)) {
      const list = el('div', 'bm-dist');
      for (const other of design.parts) {
        if (other.id === item.id) continue;
        list.append(el('span', 'bm-dist-row',
          `${other.name} — ${round(distance(item, other))}px`));
      }
      inspector.append(el('p', 'bm-note-head', '다른 파츠까지의 거리'), list);
    }

    inspector.append(deleteRow('지우기', () => {
      design.shapes = design.shapes.filter((shape) => shape.id !== item.id);
      design.parts = design.parts.filter((part) => part.id !== item.id);
      selectedId = null;
    }));
  }

  function numberRow(
    label: string, value: number, min: number, max: number,
    apply: (value: number) => void, unit: string,
  ): HTMLElement {
    const row = el('label', 'bm-row');
    row.append(el('span', '', label));
    const field = el('input', 'bm-field');
    field.type = 'number';
    field.min = String(min);
    field.max = String(max);
    field.value = String(round(value, 2));
    field.addEventListener('change', () => {
      const next = Number(field.value);
      if (!Number.isFinite(next)) return;
      apply(Math.min(max, Math.max(min, next)));
      save();
      render();
    });
    row.append(field);
    if (unit) row.append(el('em', 'bm-unit', unit));
    return row;
  }

  function deleteRow(label: string, apply: () => void): HTMLElement {
    const button = el('button', 'bm-btn danger', label);
    button.type = 'button';
    button.addEventListener('click', () => { apply(); save(); render(); });
    return button;
  }

  /** 마지막 계산의 초당 대미지. 아직 안 돌렸으면 0 — 파괴 시각을 낼 수 없다. */
  function squadDps(): number {
    if (!lastResult || !lastResult.duration) return 0;
    return lastResult.squadTotal / lastResult.duration;
  }

  // ── 전투 조건 판 ──────────────────────────────────────────────────────────
  // 원래 창에 있던 것을 그대로 옮긴다(콘솔만 뺀다 — 계정 설정이라 보스와 무관하다).

  function renderBattle() {
    const battle = deps.currentBattle();
    battlePane.replaceChildren();
    battlePane.append(el('h3', 'bm-card-title', '전투 조건'));

    const grid = el('div', 'bm-grid');
    grid.append(battleNumber('전투 시간', battle.duration, 10, 180, '초', (value) => {
      deps.applyBattle({ ...deps.currentBattle(), duration: Math.trunc(value) });
    }));
    grid.append(battleSelect('적 코드', battle.enemyCode, [
      ['', '없음'], ['풍압', '풍압'], ['수냉', '수냉'], ['작열', '작열'],
      ['전격', '전격'], ['철갑', '철갑'],
    ], (value) => {
      deps.applyBattle({ ...deps.currentBattle(), enemyCode: value as ElementCode });
    }));
    grid.append(battleNumber('적 방어력', battle.enemyDef, 0, 999_999, '', (value) => {
      deps.applyBattle({ ...deps.currentBattle(), enemyDef: Math.trunc(value) });
    }));
    grid.append(battleNumber('싱크로 레벨', battle.synchroLevel, 1, 1400, 'Lv', (value) => {
      deps.applyBattle({ ...deps.currentBattle(), synchroLevel: Math.trunc(value) });
    }));
    grid.append(battleNumber('난수 시드', battle.seed, 0, 2_147_483_647, '', (value) => {
      deps.applyBattle({ ...deps.currentBattle(), seed: Math.trunc(value) });
    }));
    grid.append(battleSelect('난수 처리', battle.rngMode, [
      ['expected', '기대값 (권장)'], ['random', '난수'],
    ], (value) => {
      deps.applyBattle({ ...deps.currentBattle(), rngMode: value as BattleSettings['rngMode'] });
    }));
    grid.append(battleNumber('버스트 게이지 충전', battle.burstRegenTime, 0, 20, '초', (value) => {
      deps.applyBattle({ ...deps.currentBattle(), burstRegenTime: value });
    }));
    grid.append(battleNumber('버스트 반응속도', battle.burstReaction, 0, 3, '초', (value) => {
      deps.applyBattle({ ...deps.currentBattle(), burstReaction: value });
    }));
    battlePane.append(grid);

    battlePane.append(toggleRow('족자 중 버스트 충전 정지', battle.immuneBlocksBurst, (on) => {
      deps.applyBattle({ ...deps.currentBattle(), immuneBlocksBurst: on });
    }));

    // 적정거리 — 무기군 단위로 켠다.
    const rangeBox = el('div', 'bm-chips');
    const weapons = deps.settings.optimalRangeWeapons ?? deps.settings.weaponTypes;
    for (const weapon of weapons) {
      const chip = el('button', 'bm-chip', weapon);
      chip.type = 'button';
      if (battle.optimalRangeWeapons.includes(weapon)) chip.classList.add('is-on');
      chip.addEventListener('click', () => {
        const now = deps.currentBattle();
        const on = now.optimalRangeWeapons.includes(weapon);
        deps.applyBattle({
          ...now,
          optimalRangeWeapons: on
            ? now.optimalRangeWeapons.filter((entry) => entry !== weapon)
            : [...now.optimalRangeWeapons, weapon],
        });
        render();
      });
      rangeBox.append(chip);
    }
    battlePane.append(el('p', 'bm-note-head', '적정거리'), rangeBox);

    // 보스 페이즈 — 타임라인에서 끌어 옮기는 그 구간이다.
    const phaseHead = el('div', 'bm-phase-head');
    for (const [kind, label] of [['immune', '족자 추가'], ['element', '속저 추가']] as const) {
      const button = el('button', 'bm-chip add', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        const now = deps.currentBattle();
        const start = Math.min(now.duration - 5, 10);
        if (kind === 'immune') {
          deps.applyBattle({
            ...now, immuneWindows: [...now.immuneWindows, { from: start, to: start + 5 }],
          });
        } else {
          deps.applyBattle({
            ...now,
            elementWindows: [...now.elementWindows, { from: start, to: start + 5, code: '풍압' }],
          });
        }
        render();
      });
      phaseHead.append(button);
    }
    battlePane.append(el('p', 'bm-note-head', '보스 페이즈'), phaseHead);
    battlePane.append(el('p', 'bm-note',
      '족자 구간에는 무대에서 보스가 사라지고, 속저 구간에는 그 코드 색 방어막이 덮입니다. '
      + '아래 타임라인에서 끌어 옮기고 길이를 조절할 수 있습니다.'));

    // 폭발 반경 — 참고선이라는 것을 분명히 적는다.
    const squad = deps.currentSquad().filter(Boolean);
    if (squad.length > 0) {
      const blast = el('div', 'bm-blast-rows');
      const aim = aimPoint(design);
      for (const name of squad) {
        const radius = design.explosion[name] ?? 0;
        const row = numberRow(name, radius, 0, 600, (value) => {
          if (value > 0) design.explosion[name] = value;
          else delete design.explosion[name];
        }, 'px');
        // 그 폭발이 파츠를 몇 개나 덮는지 — 「거리와 폭발범위를 맞춘다」는 게 이 숫자다.
        if (radius > 0 && aim && design.parts.length > 0) {
          const covered = partsInBlast(design.parts, aim, radius);
          row.append(el('em', covered.length > 1 ? 'bm-cover is-on' : 'bm-cover',
            `파츠 ${covered.length}개`));
        }
        blast.append(row);
      }
      const preset = el('button', 'bm-chip add', `전원 ${DEFAULT_BLAST}px로 채우기`);
      preset.type = 'button';
      preset.addEventListener('click', () => {
        for (const name of squad) design.explosion[name] = DEFAULT_BLAST;
        save();
        render();
      });
      battlePane.append(el('p', 'bm-note-head', '폭발 반경 (참고선)'), blast, preset);
      battlePane.append(el('p', 'bm-note',
        '계산에는 들어가지 않습니다 — 엔진은 폭발 범위를 다루지 않습니다. 겨냥한 자리에서 '
        + '파츠 둘을 한 번에 덮는지 눈으로 맞춰 보는 자리입니다.'));
    }
  }

  function battleNumber(
    label: string, value: number, min: number, max: number, unit: string,
    apply: (value: number) => void,
  ): HTMLElement {
    return numberRow(label, value, min, max, (next) => { apply(next); }, unit);
  }

  function battleSelect(
    label: string, value: string, options: Array<[string, string]>,
    apply: (value: string) => void,
  ): HTMLElement {
    const row = el('label', 'bm-row');
    row.append(el('span', '', label));
    const select = el('select', 'bm-field');
    for (const [key, text] of options) {
      const option = el('option', '', text);
      option.value = key;
      select.append(option);
    }
    select.value = value;
    select.addEventListener('change', () => { apply(select.value); render(); });
    row.append(select);
    return row;
  }

  function toggleRow(label: string, on: boolean, apply: (on: boolean) => void): HTMLElement {
    // 클래스 이름은 `bm-`으로 시작한다 — 계산기 본체에 이미 `.toggle`(스위치 알약)이
    // 있어서, 그냥 `toggle`로 두면 34×18px 알약 규칙이 이 줄을 통째로 눌러 버린다.
    const row = el('label', 'bm-row bm-toggle');
    const box = el('input', '');
    box.type = 'checkbox';
    box.checked = on;
    box.addEventListener('change', () => { apply(box.checked); render(); });
    row.append(box, el('span', '', label));
    return row;
  }

  // ── 타임라인 ──────────────────────────────────────────────────────────────

  async function runTimeline() {
    if (running) return;
    const squad = deps.currentSquad().filter(Boolean);
    if (squad.length === 0) {
      runNote.textContent = '먼저 덱에 니케를 편성해 주세요.';
      return;
    }
    running = true;
    runNote.textContent = '계산하는 중…';
    try {
      const battle = deps.currentBattle();
      // 그림에서 뽑은 값이 전투 조건보다 앞선다 — 지금 보고 있는 보스로 재는 것이다.
      const derived = derivedEnemy(design, squadDps(), battle.duration);
      const request: SimulationRequest = {
        squad,
        characters: deps.currentCharacters(),
        duration: battle.duration,
        enemyDef: battle.enemyDef,
        enemyCode: battle.enemyCode,
        corePx: derived.corePx,
        hasParts: derived.hasParts,
        seed: battle.seed,
        optimalRangeWeapons: battle.optimalRangeWeapons,
        immuneWindows: battle.immuneWindows,
        elementWindows: battle.elementWindows,
        rngMode: battle.rngMode,
        immuneBlocksBurst: battle.immuneBlocksBurst,
        normalHitCoeff: battle.normalHitCoeff,
        synchroLevel: battle.synchroLevel,
        burstRegenTime: battle.burstRegenTime,
        burstReaction: battle.burstReaction,
        console: battle.console,
        ...(derived.partBreakInterval > 0
          ? { partBreakInterval: derived.partBreakInterval } : {}),
        shotTrack: true,
      };
      const result = await deps.simulate(request);
      lastResult = result;
      shots = result.shots ?? null;
      cursor = 0;
      runNote.textContent = `${squad.length}명 · ${result.duration}초 · 총 ${result.hitCount.toLocaleString('ko-KR')}발`;
      render();
    } catch (error) {
      runNote.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
    }
  }

  function renderTracks() {
    tracks.replaceChildren();
    const battle = deps.currentBattle();
    const duration = battle.duration;
    scrub.hidden = shots === null;
    cursorInput.max = String(duration);
    cursorInput.step = String(shots?.bucket ?? 0.1);
    cursorInput.value = String(cursor);
    cursorLabel.textContent = `${round(cursor)}초`;

    // 보스 상태 줄 — 족자·속저를 끌어 옮긴다.
    tracks.append(phaseTrack('족자', battle.immuneWindows.map((w, index) => ({
      index, from: w.from, to: w.to, color: '#8ea9c4', label: '족자',
    })), duration, (index, from, to) => {
      const now = deps.currentBattle();
      const next = [...now.immuneWindows];
      next[index] = { from, to };
      deps.applyBattle({ ...now, immuneWindows: next });
    }, (index) => {
      const now = deps.currentBattle();
      deps.applyBattle({
        ...now, immuneWindows: now.immuneWindows.filter((_, at) => at !== index),
      });
    }));
    tracks.append(phaseTrack('속저', battle.elementWindows.map((w, index) => ({
      index, from: w.from, to: w.to, color: ELEMENT_COLOR[w.code] ?? '#8ab', label: w.code,
    })), duration, (index, from, to) => {
      const now = deps.currentBattle();
      const next = [...now.elementWindows];
      next[index] = { ...next[index]!, from, to };
      deps.applyBattle({ ...now, elementWindows: next });
    }, (index) => {
      const now = deps.currentBattle();
      deps.applyBattle({
        ...now, elementWindows: now.elementWindows.filter((_, at) => at !== index),
      });
    }));

    // 파츠 파괴 예상 시각.
    if (design.parts.length > 0) {
      const row = el('div', 'bm-track');
      row.append(el('span', 'bm-track-name', '파츠 파괴'));
      const lane = el('div', 'bm-lane');
      for (const entry of partBreaks(design.parts, squadDps(), duration)) {
        if (entry.at === null) continue;
        const mark = el('i', 'bm-break');
        mark.style.left = `${(entry.at / duration) * 100}%`;
        mark.title = `${entry.name} — ${round(entry.at)}초`;
        lane.append(mark);
      }
      row.append(lane);
      tracks.append(row);
    }

    if (!shots) {
      tracks.append(el('p', 'bm-note',
        '「현재 덱으로 타임라인 구성」을 누르면 누가 언제 쏘는지, 그때 보스가 어떤 상태인지 이 자리에 펼칩니다.'));
      return;
    }

    // 니케별 사격 밀도.
    for (const name of deps.currentSquad().filter(Boolean)) {
      const row = design.explosion[name] !== undefined ? el('div', 'bm-track has-blast') : el('div', 'bm-track');
      const label = el('span', 'bm-track-name', name);
      const face = deps.imageOf(name);
      if (face) label.style.backgroundImage = `url(${face})`;
      row.append(label);
      const lane = el('div', 'bm-lane');
      lane.append(shotCanvas(name, duration));
      row.append(lane);
      tracks.append(row);
    }
    tracks.append(el('p', 'bm-note',
      '진한 칸일수록 그 순간에 많이 쏩니다. 노란 점은 확정 코어 명중, 붉은 점은 폭발입니다. '
      + '풀버스트 밖에서도 겨냥한 곳에 집중해 쏜다고 보고 그립니다 — 인게임의 조준 배분 공식은 알 수 없어, '
      + '코어 적중은 실제보다 후하게 잡힙니다.'));
  }

  /** 사격 밀도 한 줄. 칸이 1800개까지 가므로 DOM 대신 캔버스로 찍는다. */
  function shotCanvas(name: string, duration: number): HTMLCanvasElement {
    const canvas = el('canvas', 'bm-shot');
    const width = 1200;
    const height = 22;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const row = shots?.chars[name];
    if (!ctx || !row || !shots) return canvas;
    const buckets = shots.buckets;
    const peak = Math.max(1, ...row.normal.map((value, index) => value + (row.skill[index] ?? 0)));
    for (let index = 0; index < buckets; index += 1) {
      const total = (row.normal[index] ?? 0) + (row.skill[index] ?? 0);
      if (total === 0) continue;
      const x = (index / buckets) * width;
      const w = Math.max(1, width / buckets);
      ctx.fillStyle = `rgba(69,214,208,${0.25 + 0.65 * (total / peak)})`;
      ctx.fillRect(x, 4, w, height - 8);
      if ((row.core[index] ?? 0) > 0) {
        ctx.fillStyle = 'rgba(255,191,60,.95)';
        ctx.fillRect(x, 0, w, 3);
      }
      if ((row.explode[index] ?? 0) > 0) {
        ctx.fillStyle = 'rgba(255,119,135,.95)';
        ctx.fillRect(x, height - 3, w, 3);
      }
    }
    void duration;
    return canvas;
  }

  interface PhaseBar {
    index: number;
    from: number;
    to: number;
    color: string;
    label: string;
  }

  /** 구간 줄 하나. 몸통을 끌면 옮기고, 양 끝을 끌면 길이를 바꾼다. */
  function phaseTrack(
    title: string, bars: PhaseBar[], duration: number,
    move: (index: number, from: number, to: number) => void,
    remove: (index: number) => void,
  ): HTMLElement {
    const row = el('div', 'bm-track phase');
    row.append(el('span', 'bm-track-name', title));
    const lane = el('div', 'bm-lane');
    for (const bar of bars) {
      const node = el('div', 'bm-bar');
      node.style.left = `${(bar.from / duration) * 100}%`;
      node.style.width = `${((bar.to - bar.from) / duration) * 100}%`;
      node.style.setProperty('--bar', bar.color);
      node.append(el('span', 'bm-bar-label', `${bar.label} ${round(bar.from)}–${round(bar.to)}초`));
      const left = el('i', 'bm-bar-grip left');
      const right = el('i', 'bm-bar-grip right');
      node.append(left, right);

      const drag = (event: PointerEvent, mode: 'move' | 'left' | 'right') => {
        event.preventDefault();
        event.stopPropagation();
        const box = lane.getBoundingClientRect();
        const at = (clientX: number) => ((clientX - box.left) / box.width) * duration;
        const grabbed = at(event.clientX);
        const start = bar.from;
        const end = bar.to;
        const onMove = (moveEvent: PointerEvent) => {
          const delta = at(moveEvent.clientX) - grabbed;
          let from = start;
          let to = end;
          if (mode === 'move') { from = start + delta; to = end + delta; }
          if (mode === 'left') from = Math.min(end - 0.5, start + delta);
          if (mode === 'right') to = Math.max(start + 0.5, end + delta);
          from = Math.max(0, Math.min(duration, from));
          to = Math.max(0.5, Math.min(duration, to));
          node.style.left = `${(from / duration) * 100}%`;
          node.style.width = `${((to - from) / duration) * 100}%`;
          move(bar.index, round(from), round(to));
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          render();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };
      node.addEventListener('pointerdown', (event) => drag(event, 'move'));
      left.addEventListener('pointerdown', (event) => drag(event, 'left'));
      right.addEventListener('pointerdown', (event) => drag(event, 'right'));
      node.addEventListener('dblclick', () => { remove(bar.index); render(); });
      lane.append(node);
    }
    row.append(lane);
    return row;
  }

  // ── 묶기 ──────────────────────────────────────────────────────────────────

  function render() {
    nameInput.value = design.name;
    narrow.hidden = window.innerWidth >= MIN_WIDTH;
    drawStage();
    renderInspector();
    renderBattle();
    renderTracks();
  }

  nameInput.addEventListener('input', () => { design.name = nameInput.value; save(); });
  cursorInput.addEventListener('input', () => {
    cursor = Number(cursorInput.value);
    cursorLabel.textContent = `${round(cursor)}초`;
    drawStage();
  });
  q<HTMLButtonElement>('[data-bm-run]').addEventListener('click', () => { void runTimeline(); });
  q<HTMLButtonElement>('[data-bm-close]').addEventListener('click', () => { close(); });
  q<HTMLButtonElement>('[data-bm-reset]').addEventListener('click', () => {
    design = emptyDesign();
    selectedId = null;
    shots = null;
    save();
    render();
  });
  q<HTMLButtonElement>('[data-bm-apply]').addEventListener('click', () => {
    const battle = deps.currentBattle();
    const derived = derivedEnemy(design, squadDps(), battle.duration);
    deps.applyBattle({
      ...battle,
      coreEnabled: derived.corePx > 0,
      corePx: derived.corePx || battle.corePx,
      hasParts: derived.hasParts,
    });
    runNote.textContent = `전투 조건에 반영했습니다 — 코어 ${derived.corePx || '없음'}${derived.corePx ? 'px' : ''} · 파츠 ${derived.hasParts ? '있음' : '없음'}`;
    render();
  });

  // 밑그림.
  q<HTMLInputElement>('[data-bm-image]').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      design.image = {
        src: String(reader.result), x: 0, y: 0,
        w: design.canvas.w, h: design.canvas.h, opacity: 0.45,
      };
      save();
      render();
    });
    reader.readAsDataURL(file);
  });
  q<HTMLInputElement>('[data-bm-image-opacity]').addEventListener('input', (event) => {
    if (!design.image) return;
    design.image.opacity = Number((event.target as HTMLInputElement).value) / 100;
    drawStage();
  });
  q<HTMLInputElement>('[data-bm-image-scale]').addEventListener('input', (event) => {
    if (!design.image) return;
    const scale = Number((event.target as HTMLInputElement).value) / 100;
    design.image.w = design.canvas.w * scale;
    design.image.h = design.canvas.h * scale;
    drawStage();
  });
  q<HTMLButtonElement>('[data-bm-image-clear]').addEventListener('click', () => {
    design.image = null;
    save();
    render();
  });

  // 고른 것 지우기 — Delete·Backspace.
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (!selectedId) return;
    event.preventDefault();
    if (selectedId === 'core') design.core = null;
    else if (selectedId === 'center') design.center = null;
    else {
      design.shapes = design.shapes.filter((shape) => shape.id !== selectedId);
      design.parts = design.parts.filter((part) => part.id !== selectedId);
    }
    selectedId = null;
    save();
    render();
  });

  const onResize = () => { narrow.hidden = window.innerWidth >= MIN_WIDTH; };
  window.addEventListener('resize', onResize);

  function open() {
    host.hidden = false;
    document.body.classList.add('bm-open');
    render();
    host.focus();
  }
  function close() {
    host.hidden = true;
    document.body.classList.remove('bm-open');
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !host.hidden) close();
  });

  return { open, close };
}
