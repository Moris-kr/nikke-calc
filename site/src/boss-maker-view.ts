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
  activeDesign, aimAt, aimForNikke, aimPoint, coreHitChance, copyDesign, decodeBossCode,
  DEFAULT_CORE_PX, derivedEnemy, derivedOptimalRange, distance,
  dropDesign, ELEMENT_COLOR, emptyDesign, emptyLibrary, encodeBossCode, hitTest, impactOffsets,
  inFullBurst, mixRangeColor, newId, parseLibrary, partBreaks, partsInBlast, phaseAt,
  aimedPartBreaks, pierceTargets, putDesign, RANGE_COLOR, resizeBox, scoreUntil, spreadRadius,
  tidyWindows, visibleAt,
  type BossDesign, type BossLibrary, type BossPart, type BossShape, type PartBreak,
  type ResizeGrip, type ShapeKind,
} from './boss-maker';
import {
  spanTargets,
  type BattleSettings, type BurstCast, type CharacterMeta, type CharacterOverrides,
  type ElementCode,
  type SettingsCatalog, type ShotTrack, type SimulationRequest, type SimulationResult,
  type StateTrack,
} from './types';
import type { StorageLike } from './cache';
import { confirmTwice } from './confirm-twice';
import { hacksForRequest } from './hacks';
import { formatDamage, formatDps } from './model';
import { mountSharePanel, type SharePanel } from './share-panel';
import type { ShareServer } from './share-server';

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
  /** 공유 서버. 없으면(주소가 안 박힌 빌드) 코드 주고받기만 남는다. */
  shareServer?: ShareServer | null;
  /** 창이 닫힐 때. 부른 쪽의 탭 표시를 되돌리는 데 쓴다. */
  onClose?: () => void;
  /** 피드백 창을 여는 길. 없으면(공유 서버가 없는 빌드) 단추를 안 낸다. */
  openFeedback?: () => void;
}

export interface BossMakerHandle {
  open: () => void;
  close: () => void;
}

/** 저장함. 옛 단일 저장본(`nikke-boss-design-v1`)도 읽어 한 벌짜리로 감싼다. */
const LIBRARY_KEY = 'nikke-boss-library-v1';
const LEGACY_KEY = 'nikke-boss-design-v1';
/** 폭발 반경 기본값(px). 인게임 값이 아니라 «눈으로 맞춰 보는» 자리라 넉넉히 둔다. */
const DEFAULT_BLAST = 90;
/** 이 폭보다 좁으면 구성은 못 하게 막는다 — 무대와 판이 함께 서지 못한다. */
const MIN_WIDTH = 1024;

/** 니케 다섯을 가르는 색. 탄착군 원이 한 점에 포개지므로 색으로만 갈린다. */
const AIM_COLORS = ['#45d6d0', '#ffbf3c', '#8ab6ff', '#ff8f6b', '#c79bff'];

/**
 * 적정거리 색을 칠하는 진하기.
 *
 * 꽉 채우면 밑그림도, 겹쳐 놓은 도형도, 그 위의 탄착점도 다 가린다 — 도형 기본색이
 * 처음부터 반투명인 것과 같은 이유다. 반투명이면 겹친 자리에서 색이 실제로 섞여 보여,
 * 「여럿이면 섞인 색」이 화면에서도 그대로 성립한다.
 */
const RANGE_FILL = 0.32;

/** 속저에 고를 수 있는 속성. 전투 조건 창의 목록과 같다. */
const ELEMENT_CODES: ElementCode[] = ['풍압', '수냉', '작열', '전격', '철갑'];

/** 레이어 목록에 적는 이름. 도구 단추와 같은 말을 쓴다. */
const SHAPE_LABEL: Record<ShapeKind, string> = { circle: '원', rect: '네모', triangle: '삼각형' };

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

/**
 * 도형 하나를 SVG 요소로. 삼각형만 점 셋으로 그린다.
 *
 * 기울기는 **그리는 쪽에서도 돌려야 한다** — 판정(`hitTest`)만 돌리고 그림을 그대로
 * 두면, 눌러야 잡히는 자리와 보이는 자리가 어긋난다.
 */
function shapeNode(shape: BossShape): SVGElement {
  const node = buildShape(shape);
  if (shape.rotation) {
    node.setAttribute('transform', `rotate(${shape.rotation} ${shape.x} ${shape.y})`);
  }
  return node;
}

function buildShape(shape: BossShape): SVGElement {
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
  let library: BossLibrary = readLibrary();
  let design: BossDesign = activeDesign(library);
  let selectedId: string | null = null;
  /** 다음 무대 클릭으로 놓을 것. 없으면 고르기 모드다 */
  let placing: ShapeKind | 'part' | 'core' | 'center' | null = null;
  let shots: ShotTrack | null = null;
  let states: StateTrack | null = null;
  let lastResult: SimulationResult | null = null;
  let cursor = 0;
  let running = false;
  /**
   * 캐릭터별 «여기까지의 누적 딜». 칸마다 앞자리를 다 더해 둔 표라, 커서가 움직일
   * 때마다 1,800칸을 다시 더하지 않고 한 번만 읽는다.
   */
  let cumulative: Record<string, number[]> = {};
  let cumulativeBucket = 1;
  /** 재생 중인가. 재생하면 커서가 실제 시간대로 흘러간다 */
  let playing = false;
  /** 재생 속도 배수. 180초를 실시간으로 보고 있을 수는 없다 */
  let speed = 2;
  let rafId = 0;
  let lastFrame = 0;

  function readLibrary(): BossLibrary {
    try {
      const store = deps.storage();
      return parseLibrary(store?.getItem(LIBRARY_KEY) ?? null)
        // 보스를 하나만 두던 시절에 그려 둔 것 — 사라지면 안 되니 감싸서 들인다.
        ?? parseLibrary(store?.getItem(LEGACY_KEY) ?? null)
        ?? emptyLibrary();
    } catch {
      return emptyLibrary();
    }
  }
  /** 지금 판을 저장함에 밀어 넣고 통째로 적는다. 모든 손질이 이 한 곳을 지난다. */
  function save() {
    breakCache = null;      // 그림이 바뀌면 파괴 시각도 다시 내야 한다
    library = putDesign(library, design);
    try {
      deps.storage()?.setItem(LIBRARY_KEY, JSON.stringify(library));
    } catch {
      /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */
    }
  }
  /** 다른 저장본을 편다. 지금 것을 먼저 갈무리한다. */
  function openDesign(id: string) {
    save();
    library = { ...library, activeId: id };
    design = activeDesign(library);
    selectedId = null;
    shots = null;
    save();
    render();
  }

  // ── 뼈대 ──────────────────────────────────────────────────────────────────
  host.classList.add('boss-maker');
  host.hidden = true;
  host.innerHTML = `
    <div class="bm-frame" role="dialog" aria-label="보스 메이커">
      <header class="bm-top">
        <div class="bm-title">
          <b>보스 메이커</b>
          <select class="bm-picker" data-bm-picker aria-label="저장본 고르기"></select>
          <input type="text" class="bm-name" data-bm-name maxlength="24" placeholder="보스 이름" />
        </div>
        <div class="bm-top-actions">
          <button type="button" class="bm-help-open" data-bm-help-open aria-label="사용설명서" title="사용설명서">i</button>
          <button type="button" class="bm-btn ghost" data-bm-new title="빈 판을 하나 더 만듭니다">새 보스</button>
          <button type="button" class="bm-btn ghost" data-bm-copy title="지금 보스를 통째로 베낍니다">복제</button>
          <button type="button" class="bm-btn ghost danger-text" data-bm-drop title="지금 보스를 저장함에서 지웁니다">삭제</button>
          <button type="button" class="bm-btn" data-bm-share-open title="보스를 코드 한 줄로 주고받습니다">공유</button>
          <button type="button" class="bm-btn" data-bm-apply>전투 조건에 반영</button>
          <button type="button" class="bm-close" data-bm-close aria-label="닫기">✕</button>
        </div>
      </header>

      <!-- 공유 — 창을 또 띄우지 않고 머리줄 아래에 펼친다. 무대를 가리지 않는다. -->
      <div class="bm-share" data-bm-share hidden>
        <div class="share-tabs bm-share-tabs" data-bm-share-tabs></div>
        <div class="share-pane bm-share-pane" data-bm-share-pane="upload" hidden></div>
        <div class="share-pane bm-share-pane" data-bm-share-pane="list" hidden></div>
        <div class="share-pane bm-share-code" data-bm-share-pane="code">
        <div class="bm-share-col">
          <label class="bm-share-label" for="bm-share-out">이 보스의 코드</label>
          <textarea id="bm-share-out" class="bm-share-box" data-bm-share-out readonly rows="2"></textarea>
          <button type="button" class="bm-btn" data-bm-share-copy>코드 복사</button>
        </div>
        <div class="bm-share-col">
          <label class="bm-share-label" for="bm-share-in">받은 코드 넣기</label>
          <textarea id="bm-share-in" class="bm-share-box" data-bm-share-in rows="2" placeholder="NK5- 로 시작하는 코드를 붙여넣으세요"></textarea>
          <button type="button" class="bm-btn accent" data-bm-share-apply>새 보스로 받기</button>
        </div>
        <p class="bm-note bm-share-note">
          도형·파츠·코어·중앙·조준 키프레임·탄착군·폭발 반경이 담깁니다. <b>밑그림은 담기지
          않습니다</b> — 그림 한 장이면 코드가 수만 자가 되어 붙여넣는 곳에서 잘립니다.
          받으면 <b>새 저장본</b>으로 들어오므로 지금 보스는 그대로 남습니다.
        </p>
        </div>
        <p class="share-msg bm-share-msg" data-bm-share-msg hidden></p>
      </div>

      <p class="bm-narrow" data-bm-narrow hidden>
        <b>구성은 PC에서만 할 수 있습니다.</b> 무대와 설정 판이 나란히 서야 해서 좁은 화면에서는
        도형을 놓을 수 없습니다 — <b>계산은 모바일에서도 그대로 됩니다.</b> 만들어 둔 보스를
        전투 조건에 반영해 두면 어느 기기에서든 그 조건으로 계산합니다.
      </p>

      <!-- 사용설명서. 창을 또 띄우지 않고 이 화면 안에서 덮는다. -->
      <div class="bm-help" data-bm-help hidden>
        <div class="bm-help-card" role="dialog" aria-label="보스 메이커 사용설명서">
          <div class="bm-help-head">
            <b>보스 메이커 사용설명서</b>
            <button type="button" class="bm-close" data-bm-help-close aria-label="닫기">✕</button>
          </div>
          <div class="bm-help-body">
            <section>
              <h4>1. 보스를 그린다</h4>
              <p>왼쪽 <b>모양</b>에서 원·네모·삼각형을 고르고 무대를 눌러 놓습니다. 놓은 도형은
                끌어 옮기고, <b>둘레의 네모 여덟</b>으로 크기를, <b>위쪽 고리</b>로 기울기를 잡습니다
                (<b>Shift</b>를 누르고 돌리면 15°씩 끊깁니다). 크기는 <b>잡은 쪽만 움직이고 반대편은
                제자리</b>이며, <b>Alt</b>를 누르면 중심 대칭으로 커집니다. Delete로 지웁니다.</p>
              <p><b>밑그림</b>으로 보스 스크린샷을 깔고 그 위에 도형을 얹으면 모양을 맞추기 쉽습니다.
                밑그림은 이 브라우저에만 남고 공유 코드에는 담기지 않습니다.</p>
              <p>크기를 눈으로 맞출 때는 <b>격자</b>를 켜고(50px마다 선, 200px마다 숫자)
                <b>+ · −</b>나 휠로 확대합니다 — 확대한 뒤에는 빈 곳을 끌어 화면을 옮깁니다.
                겹쳐 놓아 뭐가 뭔지 모르겠으면 왼쪽 <b>레이어</b> 목록에서 짚어 고르고
                ▲▼로 앞뒤 차례를 바꿉니다.</p>
            </section>
            <section>
              <h4>2. 코어와 중앙</h4>
              <p><b>코어</b>는 겨냥의 첫째 기준이자 코어 대미지가 붙는 자리입니다. 지름이 그대로
                전투 조건의 «코어 직경»이 됩니다.</p>
              <p><b>중앙</b>은 코어가 없을 때 겨냥하는 점입니다. 풀버스트가 아닐 때 자동 사격하는
                니케들이 이 점을 때리므로, <b>코어가 없어도 반드시 찍어 두세요.</b></p>
            </section>
            <section>
              <h4>3. 파츠</h4>
              <p>파츠에는 <b>체력</b>과 <b>파괴 점수</b>를 줍니다. 체력은 지금 덱의 초당 딜로 나눠
                «몇 초에 깨지는지»를 내고, 그 시각이 지나면 무대에서 <b>회색</b>으로 바뀝니다.
                파괴 점수는 총딜에 더해집니다 — 시뮬이 때려서 낸 값이 아니라 출처가 달라 화면에
                따로 적힙니다.</p>
              <p>타임라인의 파츠 줄에서 띠를 끌면 <b>사라짐·재생성</b> 시각이 바뀝니다. 속성 판의
                «지금 사라짐 / 지금 재생성»으로 커서 자리에 바로 찍을 수도 있습니다.</p>
            </section>
            <section>
              <h4>4. 적정거리와 관통</h4>
              <p>도형을 고르면 <b>이 도형의 적정거리</b>를 무기군별로 켭니다. 켜 둔 무기군은 그
                도형을 겨냥할 때 일반 공격에 +30%가 붙고, 도형이 그 색으로 물듭니다(여럿이면 섞인 색).</p>
              <p>겨냥한 자리에 도형과 파츠가 겹쳐 있으면 <b>관통</b>이 그만큼 꿰뚫습니다. 파츠에 든
                히트는 파츠 판정을 받아 «파츠 대미지 ▲»가 실립니다. 관통이 아닌 보통 사격은
                겹쳐 있어도 한 번만 맞습니다.</p>
            </section>
            <section>
              <h4>5. 조준</h4>
              <p><b>풀버스트가 아닐 때</b>는 플레이어가 잡은 <b>3번 칸</b> 니케만 겨냥한 자리를
                때리고, 나머지 넷은 자동 사격이라 보스 중앙을 때립니다. 풀버스트에 들어가면 다
                같이 겨냥한 곳으로 몰립니다.</p>
              <p>무대 위 <b>조준 찍기</b>나 타임라인 조준 줄의 <b>+</b>를 누르고 무대를 누르면 그
                시각의 조준점이 박힙니다. 점을 끌면 시각이, 두 번 누르면 지워집니다. 키 사이는
                곧게 이어 따라갑니다.</p>
            </section>
            <section>
              <h4>6. 돌려 보기</h4>
              <p><b>현재 덱으로 타임라인 구성</b>을 누르면 지금 편성으로 한 판 돌려, 누가 언제
                어디에 쏘는지가 아래에 펼쳐집니다. <b>▶</b>로 재생하고 <b>×2</b>로 속도를 바꿉니다.
                시간 줄 아무 데나 눌러도 그 시각으로 갑니다.</p>
              <p>무대의 점은 <b>탄이 박힌 자리</b>입니다 — 계산기가 코어 명중률을 내는 그 분포로
                뿌리므로, 코어에 든 점의 비율이 실제 코어 명중률과 같습니다. <b>평타만</b> 뿌립니다.</p>
              <p>파츠 파괴 시각은 <b>한 번 돌린 뒤에야</b> 나옵니다(덱의 딜을 알아야 «체력 ÷ 딜»을
                낼 수 있습니다). 그래서 처음 돌린 뒤 한 번 더 돌리면 그 시각이 계산에 들어갑니다.</p>
            </section>
            <section>
              <h4>7. 내보내기</h4>
              <p><b>전투 조건에 반영</b>은 그림에서 뽑은 값(코어 직경·파츠 유무)을 계산기 본체의
                전투 조건에 얹습니다. <b>공유</b>는 보스를 코드 한 줄로 만들거나 서버에 올립니다 —
                밑그림만 빠지고 도형·파츠·코어·조준·탄착군이 담깁니다.</p>
              <p>보스는 여러 벌 둘 수 있습니다. 머리줄의 목록에서 고르고, <b>새 보스 · 복제 ·
                삭제</b>로 관리합니다.</p>
            </section>
            <section>
              <h4>알아 둘 것</h4>
              <p><b>구성은 PC에서만</b> 됩니다(무대와 설정 판이 나란히 서야 합니다). 만들어 둔
                보스를 전투 조건에 반영해 두면 계산은 어느 기기에서든 됩니다.</p>
              <p>좌표는 인게임과 같은 자(px)로 잽니다 — 코어 52px, 탄착군은 AR 76 · SMG 110 ·
                SG 240 · MG/SR/RL 10px입니다.</p>
            </section>
          </div>
        </div>
      </div>

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
          <!-- 레이어. 겹쳐 놓으면 무엇이 어디에 있는지 무대만 봐서는 알 수 없다 —
               목록에서 짚어 고르고, 위아래로 순서를 바꾼다(나중이 위다). -->
          <div class="bm-tool-group bm-layers-group">
            <span class="bm-tool-label">레이어</span>
            <div class="bm-layers" data-bm-layers></div>
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
          <!-- 아직 만드는 중인 화면이다. 쓰는 사람이 알려 주지 않으면 무엇이 불편한지
               알 길이 없으므로, 무대 바로 위에 한 줄로 부탁해 둔다. -->
          <p class="bm-callout">
            <b>한창 개발중이기에 많은 피드백이 필요합니다.</b>
            <span>피드백 기능을 활용해주세요!</span>
            <button type="button" class="bm-callout-go" data-bm-feedback hidden>피드백 남기기</button>
            <button type="button" class="bm-callout-x" data-bm-callout-close aria-label="안내 닫기" title="닫기">✕</button>
          </p>
          <div class="bm-squad-filter" data-bm-filter hidden></div>
          <div class="bm-stage-head">
            <span class="bm-stage-note" data-bm-center-warn hidden>
              <b>보스 중앙을 찍어 주세요.</b> 코어가 없는 보스는 이 점을 겨냥합니다.
            </span>
            <label class="bm-stage-toggle"><input type="checkbox" data-bm-show-aim checked /><span>탄착군</span></label>
            <label class="bm-stage-toggle"><input type="checkbox" data-bm-show-hits checked /><span>탄착점</span></label>
            <label class="bm-stage-toggle"><input type="checkbox" data-bm-pile /><span>누적</span></label>
            <button type="button" class="bm-stage-btn" data-bm-aim-key title="지금 시각에 조준 키프레임을 찍습니다. 무대를 누르면 그 자리로 잡힙니다">조준 찍기</button>
            <label class="bm-stage-toggle"><input type="checkbox" data-bm-grid /><span>격자</span></label>
            <!-- 확대. 수치로만 크기를 맞추던 것을 눈으로 맞출 수 있게 한다 —
                 확대해 두면 빈 곳을 끌어 화면을 옮긴다. -->
            <span class="bm-zoom">
              <button type="button" class="bm-stage-btn" data-bm-zoom="out" title="축소 (휠 아래)">−</button>
              <b data-bm-zoom-label>100%</b>
              <button type="button" class="bm-stage-btn" data-bm-zoom="in" title="확대 (휠 위)">+</button>
              <button type="button" class="bm-stage-btn" data-bm-zoom="reset" title="꽉 맞추기">맞춤</button>
            </span>
            <span class="bm-stage-meta" data-bm-stage-meta></span>
          </div>
          <div class="bm-stage-box">
            <svg class="bm-stage" data-bm-stage xmlns="${SVG_NS}"></svg>
            <!-- 지금 걸려 있는 버프. 왼쪽 기둥에 위아래로 쌓는다 — 가로로 늘어놓으면
                 스무 개가 넘어 한 줄에 안 들어온다. -->
            <div class="bm-buffs" data-bm-buffs hidden></div>
            <!-- 지금까지 넣은 딜. 커서가 선 자리까지의 누적이다. -->
            <div class="bm-hud" data-bm-hud hidden></div>
            <!-- 버스트를 쓰는 순간의 작은 연출. 무대 아래 가운데라 그림을 가리지 않는다. -->
            <div class="bm-burst-flash" data-bm-flash aria-live="polite"></div>
            <!-- 캐릭터별 상태 — 초상화 · 남은 탄 / 전체 · 지금 무엇을 하고 있나. -->
            <div class="bm-states" data-bm-states hidden></div>
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
  const zoomLabel = q<HTMLElement>('[data-bm-zoom-label]');
  const layerBox = q<HTMLElement>('[data-bm-layers]');
  const gridToggle = q<HTMLInputElement>('[data-bm-grid]');
  const centerWarn = q<HTMLElement>('[data-bm-center-warn]');
  const nameInput = q<HTMLInputElement>('[data-bm-name]');
  const narrow = q<HTMLElement>('[data-bm-narrow]');
  const runNote = q<HTMLElement>('[data-bm-run-note]');
  const showAim = q<HTMLInputElement>('[data-bm-show-aim]');
  const showHits = q<HTMLInputElement>('[data-bm-show-hits]');
  const pileHits = q<HTMLInputElement>('[data-bm-pile]');
  const buffBar = q<HTMLElement>('[data-bm-buffs]');
  const hud = q<HTMLElement>('[data-bm-hud]');
  const flash = q<HTMLElement>('[data-bm-flash]');
  const statePanel = q<HTMLElement>('[data-bm-states]');
  /** 다음 무대 누르기를 조준 키프레임 찍기로 쓸지 */
  let aimPicking = false;
  const filterBar = q<HTMLElement>('[data-bm-filter]');
  /** 화면에서 감춘 니케. 탄착군·탄착점·사격 줄·버프가 함께 빠진다 */
  const hidden = new Set<string>();
  const picker = q<HTMLSelectElement>('[data-bm-picker]');

  /** 저장본 목록. 이름이 같아도 되도록 값은 id다. */
  function renderPicker() {
    picker.replaceChildren();
    for (const entry of library.designs) {
      const option = el('option', '', entry.name || '이름 없음');
      option.value = entry.id;
      picker.append(option);
    }
    picker.value = design.id;
    picker.title = `저장본 ${library.designs.length}개`;
  }

  const accuracy = deps.settings.accuracy;
  /** 지금 화면에 그릴 니케. 감춘 사람은 무대에서도 타임라인에서도 빠진다. */
  const shownSquad = (): string[] =>
    deps.currentSquad().filter((name) => name && !hidden.has(name));

  /** 그 시각이 풀버스트 안인가. 계산해 본 적이 없으면 «아니다»로 본다. */
  const fullBurstNow = (t: number): boolean =>
    inFullBurst(lastResult?.timeline?.fullBurst ?? [], t);

  /** 이 니케가 그 시각에 겨냥하는 자리. 편성 칸 번호로 «플레이어가 잡은 니케»를 가른다. */
  const aimOf = (name: string, t: number): { x: number; y: number } | null => {
    const slot = deps.currentSquad().indexOf(name);
    return aimForNikke(design, t, slot, fullBurstNow(t));
  };

  /** 이 니케의 탄착군 반지름. 손으로 적어 둔 지름이 있으면 그것이 먼저다. */
  const spreadOf = (name: string): number =>
    spreadRadius(accuracy, weaponOf(name), 0, design.spread?.[name]);
  const weaponOf = (name: string) => deps.settings.characters[name]?.weaponType ?? 'AR';
  const allItems = (): BossShape[] => [...design.shapes, ...design.parts];
  const findItem = (id: string | null): BossShape | undefined =>
    allItems().find((item) => item.id === id);
  const isPart = (id: string): boolean => design.parts.some((part) => part.id === id);

  // ── 무대 그리기 ───────────────────────────────────────────────────────────

  /**
   * 무대를 들여다보는 창. `zoom`이 1이면 캔버스 전체가 보인다.
   *
   * 「수치 입력으로만 스케일을 맞춰야 한다」는 말이 있었다 — 눈으로 맞추려면 키워
   * 봐야 하고, 키우면 화면을 옮길 수 있어야 한다.
   */
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 8;

  /** 확대해도 캔버스 밖이 보이지 않게 잡아 둔다. */
  function clampPan() {
    const w = design.canvas.w / zoom;
    const h = design.canvas.h / zoom;
    panX = Math.min(Math.max(0, panX), Math.max(0, design.canvas.w - w));
    panY = Math.min(Math.max(0, panY), Math.max(0, design.canvas.h - h));
  }

  /** 무대 위 한 점을 그대로 둔 채 배율만 바꾼다(휠 확대). */
  function setZoom(next: number, keep?: { x: number; y: number }) {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (clamped === zoom) return;
    const anchor = keep ?? {
      x: panX + design.canvas.w / zoom / 2,
      y: panY + design.canvas.h / zoom / 2,
    };
    // 잡은 점이 화면에서 차지하던 비율을 그대로 지킨다.
    const ratioX = (anchor.x - panX) / (design.canvas.w / zoom);
    const ratioY = (anchor.y - panY) / (design.canvas.h / zoom);
    zoom = clamped;
    panX = anchor.x - ratioX * (design.canvas.w / zoom);
    panY = anchor.y - ratioY * (design.canvas.h / zoom);
    clampPan();
    drawStage();
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function drawStage() {
    clampPan();
    stage.setAttribute(
      'viewBox',
      `${round(panX)} ${round(panY)} ${round(design.canvas.w / zoom)} ${round(design.canvas.h / zoom)}`,
    );
    stage.replaceChildren();

    const at = shots ? cursor : 0;
    const battle = deps.currentBattle();
    const phase = phaseAt(at, battle.immuneWindows, battle.elementWindows);

    // 격자와 눈금 — 「구석에 뭐라도 기준이 될 만한 게 있으면」이라는 말에 대한 답이다.
    // 50px마다 선, 100px마다 숫자. 밑그림보다 아래에 깔아 그림을 가리지 않는다.
    if (gridToggle.checked) {
      const grid = svgEl('g');
      grid.setAttribute('class', 'bm-grid');
      const step = 50;
      for (let x = 0; x <= design.canvas.w; x += step) {
        const line = svgEl('line');
        attrs(line, { x1: x, y1: 0, x2: x, y2: design.canvas.h });
        line.setAttribute('class', x % 200 === 0 ? 'bm-grid-line is-major' : 'bm-grid-line');
        grid.append(line);
        if (x % 200 === 0 && x > 0) {
          const mark = svgEl('text');
          attrs(mark, { x: x + 3, y: 12 });
          mark.setAttribute('class', 'bm-grid-mark');
          mark.textContent = String(x);
          grid.append(mark);
        }
      }
      for (let y = 0; y <= design.canvas.h; y += step) {
        const line = svgEl('line');
        attrs(line, { x1: 0, y1: y, x2: design.canvas.w, y2: y });
        line.setAttribute('class', y % 200 === 0 ? 'bm-grid-line is-major' : 'bm-grid-line');
        grid.append(line);
        if (y % 200 === 0 && y > 0) {
          const mark = svgEl('text');
          attrs(mark, { x: 3, y: y - 3 });
          mark.setAttribute('class', 'bm-grid-mark');
          mark.textContent = String(y);
          grid.append(mark);
        }
      }
      stage.append(grid);
    }

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
      // 적정거리가 걸린 도형은 그 무기군 색으로 칠한다. 여럿이면 섞인 색이다.
      const tint = mixRangeColor(shape.range);
      node.setAttribute('fill', tint ?? shape.color);
      if (tint) {
        node.setAttribute('fill-opacity', String(RANGE_FILL));
        node.setAttribute('stroke', tint);
      }
      node.dataset.bmItem = shape.id;
      body.append(node);
    }
    // 깨진 파츠는 회색이다. 「이 시각엔 이미 부서져 있다」가 한눈에 보여야 파괴 시각을
    // 옮겨 가며 맞출 수 있다.
    const breaks = currentBreaks();
    const brokenAt = new Map(breaks.map((entry) => [entry.id, entry.at]));
    for (const part of visibleAt(design.parts, at)) {
      const node = shapeNode(part);
      const breakTime = brokenAt.get(part.id);
      const broken = shots !== null && breakTime !== null && breakTime !== undefined
        && at >= breakTime;
      node.setAttribute('class',
        `bm-part${broken ? ' is-broken' : ''}${selectedId === part.id ? ' is-on' : ''}`);
      const partTint = broken ? null : mixRangeColor(part.range);
      if (partTint) {
        node.setAttribute('fill', partTint);
        node.setAttribute('fill-opacity', String(RANGE_FILL));
        node.setAttribute('stroke', partTint);
      }
      node.dataset.bmItem = part.id;
      body.append(node);
      const label = svgEl('text');
      attrs(label, { x: part.x, y: part.y - part.h / 2 - 6, 'text-anchor': 'middle' });
      label.setAttribute('class', broken ? 'bm-part-label is-broken' : 'bm-part-label');
      label.textContent = broken ? `${part.name} 파괴` : part.name;
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

    // 족자에는 보스가 사라져 무대가 텅 빈다 — 무슨 구간인지 글씨로 적어 준다.
    if (phase.immune || phase.shield) {
      const mark = svgEl('text');
      attrs(mark, { x: design.canvas.w / 2, y: 52, 'text-anchor': 'middle' });
      mark.setAttribute('class', 'bm-phase-mark');
      mark.setAttribute('fill', phase.immune ? '#8ea9c4' : (ELEMENT_COLOR[phase.shield!] ?? '#8ab'));
      // 둘이 겹치면 둘 다 적는다 — 족자만 적으면 속저가 걸린 줄 모른다.
      mark.textContent = [phase.immune ? '족자' : '', phase.shield ? `속저 · ${phase.shield}` : '']
        .filter(Boolean).join('   ');
      stage.append(mark);

      const sub = svgEl('text');
      attrs(sub, { x: design.canvas.w / 2, y: 74, 'text-anchor': 'middle' });
      sub.setAttribute('class', 'bm-phase-sub');
      sub.setAttribute('fill', 'rgba(234,242,248,.75)');
      sub.textContent = [
        phase.immune ? '평타가 빗나갑니다' : '',
        phase.shield ? `${phase.shield}에 우월한 니케의 딜만 통합니다` : '',
      ].filter(Boolean).join(' · ');
      stage.append(sub);
    }

    const hits = drawImpacts(phase.immune);
    drawAim(phase.immune);
    drawHandles();
    updateStageMeta(hits);
    renderBuffs();
    renderHud();
    renderFlash();
    renderStates();
  }

  /**
   * 니케마다 탄착군 원과 폭발 원을 겹쳐 그린다. 조준점은 코어 → 중앙 차례다.
   *
   * **니케마다 색을 달리하고 이름표를 끌어낸다.** 조준점이 하나뿐이라 원들이 정확히
   * 겹쳐 그려지는데, MG·SR·RL은 탄착군이 10px이라 다섯이 한 점에 포개지면 아무것도
   * 안 보인다. 원은 실제 크기 그대로 두고(줄이거나 늘리면 거짓말이 된다) 이름표를
   * 사방으로 뻗어, 작은 원도 «여기 있다»가 읽히게 한다.
   */
  function drawAim(gone: boolean) {
    const base = aimAt(design, cursor);
    centerWarn.hidden = !(base === null || (design.core === null && design.center === null));
    if (!base || gone || !showAim.checked) return;

    const squad = shownSquad();
    const group = svgEl('g');
    group.setAttribute('class', 'bm-aim');
    const step = squad.length > 0 ? (Math.PI * 2) / squad.length : 0;
    for (const [index, name] of squad.entries()) {
      const at = aimOf(name, cursor);
      if (!at) continue;
      const radius = spreadOf(name);
      const color = AIM_COLORS[deps.currentSquad().indexOf(name) % AIM_COLORS.length]!;

      const ring = svgEl('circle');
      attrs(ring, { cx: at.x, cy: at.y, r: radius });
      ring.setAttribute('class', 'bm-spread');
      ring.setAttribute('stroke', color);
      group.append(ring);

      const angle = -Math.PI / 2 + step * index;
      const near = { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius };
      const far = {
        x: at.x + Math.cos(angle) * (radius + 34),
        y: at.y + Math.sin(angle) * (radius + 34),
      };
      const lead = svgEl('line');
      attrs(lead, { x1: near.x, y1: near.y, x2: far.x, y2: far.y });
      lead.setAttribute('class', 'bm-aim-lead');
      lead.setAttribute('stroke', color);
      group.append(lead);

      const label = svgEl('text');
      attrs(label, {
        x: far.x + (Math.cos(angle) >= 0 ? 4 : -4), y: far.y + 4,
        'text-anchor': Math.cos(angle) >= 0 ? 'start' : 'end',
      });
      label.setAttribute('class', 'bm-aim-label');
      label.setAttribute('fill', color);
      const short = name.length > 9 ? `${name.slice(0, 8)}…` : name;
      label.textContent = `${short} Ø${Math.round(radius * 2)}`;
      const tip = svgEl('title');
      tip.textContent = `${name} · 탄착군 지름 ${Math.round(radius * 2)}px`;
      label.append(tip);
      group.append(label);

      const blast = design.explosion[name];
      if (blast && blast > 0 && firing(name)) {
        const circle = svgEl('circle');
        attrs(circle, { cx: at.x, cy: at.y, r: blast });
        circle.setAttribute('class', 'bm-blast');
        circle.setAttribute('stroke', color);
        group.append(circle);
      }
    }
    stage.append(group);

    // 조준 키프레임을 지나온 길로 그린다 — 어디서 어디로 옮겨 가는지가 보인다.
    const keys = [...(design.aimKeys ?? [])].sort((left, right) => left.t - right.t);
    if (keys.length > 1) {
      const path = svgEl('polyline');
      attrs(path, { points: keys.map((key) => `${key.x},${key.y}`).join(' ') });
      path.setAttribute('class', 'bm-aim-path');
      stage.append(path);
    }
    for (const key of keys) {
      const dot = svgEl('circle');
      attrs(dot, { cx: key.x, cy: key.y, r: 4 });
      dot.setAttribute('class', Math.abs(key.t - cursor) < 0.05 ? 'bm-aim-key is-on' : 'bm-aim-key');
      dot.dataset.bmAimKey = String(key.t);
      const tip = svgEl('title');
      tip.textContent = `조준 ${round(key.t)}초`;
      dot.append(tip);
      stage.append(dot);
    }
  }

  /** 접어 둔 타임라인 묶음. 그림이 아니라 «보는 방식»이라 저장본에 넣지 않는다. */
  const folded = new Set<string>();

  /** 지난번에 만든 탄착점 묶음. 같은 칸을 다시 그릴 때 그대로 쓴다. */
  let impactCache: { key: string; group: SVGElement; count: number } | null = null;

  /** 자국을 남기는 구간(초). 재생할 때 «방금 어디를 때렸나»가 읽히는 길이다. */
  const TRAIL_SECONDS = 3;
  /** 한 번에 찍는 점의 상한. 180초를 누적하면 만 발이 넘어 그리는 값이 아니다. */
  const IMPACT_CAP = 900;

  /**
   * 탄이 박힌 자리. **그 니케가 그때 겨냥한 자리** 둘레에 엔진이 코어 명중률을 내는
   * 그 분포로 뿌린다(`impactOffsets`) — 점이 코어에 드는 비율이 계산에 쓰이는 확률과 같다.
   *
   * 조준은 시각마다 다르다. 풀버스트가 아니면 플레이어가 잡은 니케(3번 칸)만 겨냥한
   * 자리를 때리고 나머지는 보스 중앙을 때리므로, 칸마다 그 시각의 조준점을 다시 구한다.
   *
   * 뿌리는 것은 **평타뿐이다.** 스킬·버스트 딜은 조준 판정을 거치지 않고 그대로 맞는다.
   *
   * 「누적」을 끄면 최근 3초치만 남아 재생하며 흐르고, 켜면 지금 시각까지 쌓인다.
   * 새 것부터 채우므로 상한에 걸리면 **오래된 자국이 먼저 빠진다**.
   */
  function drawImpacts(gone: boolean): number {
    if (!shots || gone || !showHits.checked) return 0;

    const bucket = shots.bucket;
    const last = Math.min(shots.buckets - 1, Math.floor(cursor / bucket));
    const first = pileHits.checked
      ? 0 : Math.max(0, last - Math.round(TRAIL_SECONDS / bucket));
    const squad = shownSquad();
    const modelN = accuracy?.modelN ?? 2.55;

    // 점은 **칸이 바뀔 때만** 달라진다. 재생은 초당 60번 다시 그리는데 칸은 0.1초마다
    // 넘어가므로, 같은 칸이면 지난번에 만든 묶음을 그대로 다시 붙인다
    // (누적 900점을 매 프레임 새로 만들면 한 프레임에 6.5ms가 든다).
    const key = [last, first, squad.join('·'), (design.aimKeys ?? []).length].join(':');
    if (impactCache && impactCache.key === key) {
      stage.append(impactCache.group);
      return impactCache.count;
    }

    const dots: SVGElement[] = [];
    for (let index = last; index >= first && dots.length < IMPACT_CAP; index -= 1) {
      const at = index * bucket;
      for (const name of squad) {
        const row = shots.chars[name];
        const count = row?.normal[index] ?? 0;
        if (!count) continue;
        const aim = aimOf(name, at);
        if (!aim) continue;
        const radius = spreadOf(name);
        const age = (last - index) * bucket;
        const fade = pileHits.checked ? 0.4 : Math.max(0.14, 1 - age / TRAIL_SECONDS);
        const color = AIM_COLORS[deps.currentSquad().indexOf(name) % AIM_COLORS.length]!;
        for (const offset of impactOffsets(`${name}:${index}`, count, radius, modelN)) {
          if (dots.length >= IMPACT_CAP) break;
          const dot = svgEl('circle');
          attrs(dot, { cx: aim.x + offset.x, cy: aim.y + offset.y, r: 1.7 });
          dot.setAttribute('class', 'bm-impact');
          dot.setAttribute('fill', color);
          dot.setAttribute('opacity', fade.toFixed(2));
          dots.push(dot);
        }
      }
    }
    const group = svgEl('g');
    group.setAttribute('class', 'bm-impacts');
    // 새 자국이 위로 오게 뒤집어 붙인다 — 위에서 훑을 때 방금 쏜 것이 먼저 보인다.
    group.append(...dots.reverse());
    stage.append(group);
    impactCache = { key, group, count: dots.length };
    return dots.length;
  }

  /** 지금 커서 자리에서 그 니케가 쏘고 있는가. 트랙이 없으면 늘 참으로 본다. */
  function firing(name: string): boolean {
    if (!shots) return true;
    const row = shots.chars[name];
    if (!row) return false;
    const index = Math.min(shots.buckets - 1, Math.floor(cursor / shots.bucket));
    return (row.normal[index] ?? 0) + (row.skill[index] ?? 0) > 0;
  }

  /**
   * 고른 것 둘레의 손잡이. 여덟 자리로 크기를, 위쪽 고리로 기울기를 잡는다.
   *
   * 손잡이는 도형과 **함께 돌린다** — 안 돌리면 기울어진 도형의 모서리와 손잡이가
   * 따로 놀아 어디를 잡아야 할지 알 수 없다.
   *
   * 여덟인 이유는 종전의 하나(오른쪽 아래)로는 «왼쪽 끝을 맞춰 두고 오른쪽만 늘리기»가
   * 아예 안 되기 때문이다. PPT를 써 본 손이 가는 대로 — 잡은 쪽만 움직이고 반대편은
   * 제자리에 선다(Alt는 옛 규칙인 중심 대칭).
   */
  const GRIPS: Array<{ grip: ResizeGrip; fx: number; fy: number; cursor: string }> = [
    { grip: 'nw', fx: -1, fy: -1, cursor: 'nwse-resize' },
    { grip: 'n', fx: 0, fy: -1, cursor: 'ns-resize' },
    { grip: 'ne', fx: 1, fy: -1, cursor: 'nesw-resize' },
    { grip: 'e', fx: 1, fy: 0, cursor: 'ew-resize' },
    { grip: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
    { grip: 's', fx: 0, fy: 1, cursor: 'ns-resize' },
    { grip: 'sw', fx: -1, fy: 1, cursor: 'nesw-resize' },
    { grip: 'w', fx: -1, fy: 0, cursor: 'ew-resize' },
  ];

  function drawHandles() {
    const item = findItem(selectedId);
    if (!item) return;
    const group = svgEl('g');
    if (item.rotation) {
      group.setAttribute('transform', `rotate(${item.rotation} ${item.x} ${item.y})`);
    }

    // 테두리 — 어디까지가 이 도형인지 먼저 보인다.
    const frame = svgEl('rect');
    attrs(frame, {
      x: item.x - item.w / 2, y: item.y - item.h / 2, width: item.w, height: item.h,
    });
    frame.setAttribute('class', 'bm-handle-frame');
    group.append(frame);

    for (const { grip, fx, fy, cursor } of GRIPS) {
      const size = svgEl('rect');
      attrs(size, {
        x: item.x + (fx * item.w) / 2 - 5, y: item.y + (fy * item.h) / 2 - 5,
        width: 10, height: 10,
      });
      size.setAttribute('class', 'bm-handle');
      size.style.cursor = cursor;
      size.dataset.bmHandle = item.id;
      size.dataset.bmGrip = grip;
      const tip = svgEl('title');
      tip.textContent = '끌어서 크기 (Alt: 중심 대칭)';
      size.append(tip);
      group.append(size);
    }

    // 기울기 고리는 위쪽으로 뽑아 둔다. 도형 안에 두면 옮기기와 헷갈린다.
    const arm = svgEl('line');
    attrs(arm, {
      x1: item.x, y1: item.y - item.h / 2, x2: item.x, y2: item.y - item.h / 2 - 22,
    });
    arm.setAttribute('class', 'bm-handle-arm');
    group.append(arm);
    const spin = svgEl('circle');
    attrs(spin, { cx: item.x, cy: item.y - item.h / 2 - 22, r: 6 });
    spin.setAttribute('class', 'bm-handle spin');
    spin.dataset.bmSpin = item.id;
    const spinTip = svgEl('title');
    spinTip.textContent = '끌어서 돌리기 (Shift: 15°씩)';
    spin.append(spinTip);
    group.append(spin);

    stage.append(group);
  }

  function updateStageMeta(hits = 0) {
    const parts = design.parts.length;
    const core = design.core ? `코어 ${Math.round(design.core.d)}px` : '코어 없음';
    const pair = design.parts.length >= 2
      ? ` · 파츠 최소 간격 ${round(closestPair())}px` : '';
    const shown = hits > 0
      ? ` · 탄착점 ${hits}${hits >= IMPACT_CAP ? '(상한)' : ''}` : '';
    // 지금 겨냥한 자리를 관통이 꿰뚫으면 몇을 때리나. 몸통과 파츠를 따로 센다.
    const aim = aimAt(design, cursor);
    const pierce = aim ? pierceTargets(design, aim, shots ? cursor : 0) : null;
    const through = pierce && pierce.total > 1
      ? ` · 관통 ${pierce.total}중(몸통 ${pierce.shapes}·파츠 ${pierce.parts})` : '';
    stageMeta.textContent =
      `${design.canvas.w}×${design.canvas.h}px · ${core} · 파츠 ${parts}개${pair}${shown}${through}`;
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

  gridToggle.addEventListener('change', () => drawStage());
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-bm-zoom]')) {
    button.addEventListener('click', () => {
      const how = button.dataset.bmZoom;
      if (how === 'reset') { zoom = 1; panX = 0; panY = 0; drawStage(); zoomLabel.textContent = '100%'; return; }
      setZoom(how === 'in' ? zoom * 1.25 : zoom / 1.25);
    });
  }
  // 휠은 «잡은 자리»를 그대로 두고 키운다 — 커서 아래의 것이 달아나면 못 쫓아간다.
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), stagePoint(event));
  }, { passive: false });

  stage.addEventListener('pointerdown', (event) => {
    const at = stagePoint(event);
    // 확대한 채로 빈 곳을 끌면 화면을 옮긴다(가운데 단추는 언제나). 확대하지 않았을
    // 때는 옮길 것이 없으므로 예전처럼 «고른 것 풀기»로 간다.
    const onEmpty = !(event.target as SVGElement | null)?.dataset?.bmItem
      && !(event.target as SVGElement | null)?.dataset?.bmHandle;
    if (event.button === 1 || (zoom > 1 && onEmpty && !placing && !aimPicking)) {
      event.preventDefault();
      const from = { x: at.x, y: at.y, panX, panY };
      const onMove = (moveEvent: PointerEvent) => {
        // 끌린 만큼 창을 반대로 민다. 화면 배율은 stagePoint가 이미 걷어 냈다.
        const now = stagePoint(moveEvent);
        panX = from.panX - (now.x - from.x);
        panY = from.panY - (now.y - from.y);
        drawStage();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    if (aimPicking) { putAimKey(at); return; }
    if (placing) { place(placing, at); return; }

    const target = event.target as SVGElement | null;
    const handleId = target?.dataset?.bmHandle;
    const itemId = target?.dataset?.bmItem;

    if (handleId) {
      const item = findItem(handleId);
      if (!item) return;
      const grip = (target?.dataset?.bmGrip ?? 'se') as ResizeGrip;
      // 끌기 내내 **처음 상자**를 기준으로 잰다 — 매번 방금 바꾼 상자로 재면
      // 반대편이 조금씩 밀려 손이 멈춘 자리와 도형이 어긋난다.
      const from = { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation };
      startDrag(event, (point, moveEvent) => {
        const next = resizeBox(from, grip, point, { symmetric: moveEvent.altKey });
        item.x = next.x;
        item.y = next.y;
        item.w = next.w;
        item.h = next.h;
      });
      return;
    }
    const spinId = target?.dataset?.bmSpin;
    if (spinId) {
      const item = findItem(spinId);
      if (!item) return;
      startDrag(event, (point) => {
        // 위쪽을 0°로 둔다 — 고리가 위에 달려 있으니 손이 가는 대로 돈다.
        const degrees = (Math.atan2(point.y - item.y, point.x - item.x) * 180) / Math.PI + 90;
        const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
        // Shift를 누르면 15°씩 끊어 돈다 — 반듯하게 세우려는 손이 대부분이다.
        item.rotation = Math.round(event.shiftKey ? Math.round(wrapped / 15) * 15 : wrapped);
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

  /**
   * 지금 시각에 조준 키프레임을 찍는다. 같은 시각에 이미 있으면 그 자리를 옮긴다 —
   * 한 시각에 두 자리를 겨냥할 수는 없다.
   */
  function putAimKey(at: { x: number; y: number }) {
    const t = round(cursor);
    const keys = [...(design.aimKeys ?? [])].filter((key) => Math.abs(key.t - t) >= 0.05);
    keys.push({ t, x: Math.round(at.x), y: Math.round(at.y) });
    design.aimKeys = keys.sort((left, right) => left.t - right.t);
    aimPicking = false;
    impactCache = null;
    save();
    render();
  }

  function startDrag(
    event: PointerEvent,
    // 끌던 중의 이벤트를 함께 넘긴다 — Alt·Shift 같은 «누르고 있는 키»는 끌기가
    // 시작된 순간이 아니라 **지금** 눌려 있는 것이 맞다.
    move: (point: { x: number; y: number }, moveEvent: PointerEvent) => void,
  ) {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      move(stagePoint(moveEvent), moveEvent);
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
      inspector.append(numberRow('파괴 점수', part.score ?? 0, 0, 999_999_999_999, (value) => {
        if (value > 0) part.score = value; else delete part.score;
      }, ''));
      const entry = currentBreaks().find((row) => row.id === part.id);
      const at = entry?.at ?? null;
      const taken = entry?.taken ?? 0;
      const aimed = shots !== null && lastResult?.fineTimeline !== undefined;
      // 「스치기는 하는데 모자란다」와 「한 발도 안 든다」는 다른 이야기다.
      const short = part.hp > 0 ? Math.round((taken / part.hp) * 100) : 0;
      inspector.append(el('p', 'bm-note', at !== null
        ? (aimed
          ? `이 조준대로면 약 ${round(at)}초에 깨집니다.`
          : `한 판 돌리기 전 어림값으로 약 ${round(at)}초입니다(조준을 안 본 값).`)
        : (!aimed
          ? '지금 덱의 딜로는 이 전투 안에 깨지지 않습니다.'
          : taken <= 0
            ? '이 조준으로는 탄이 한 발도 들지 않습니다 — 겨냥해야 깎입니다.'
            // 여기서는 깎지 않은 숫자가 낫다 — 「0.02억」으로 접으면 얼마나 모자란지가 안 읽힌다.
            : `이 조준으로 받는 피해는 ${Math.round(taken).toLocaleString('ko-KR')}(체력의 ${short}%)이라 깨지지 않습니다.`)));
      if (!aimed) {
        inspector.append(el('p', 'bm-note',
          '한 번 돌리면 **조준을 셈에 넣어** 다시 냅니다 — 겨냥하지 않은 파츠는 탄이 들지 '
          + '않아 깨지지 않습니다.'.replace(/\*\*/g, '')));
      }
      if ((part.score ?? 0) > 0) {
        inspector.append(el('p', 'bm-note',
          '깨면 이 점수가 총딜에 더해집니다 — 시뮬이 때려서 낸 값이 아니라 «깨면 준다»는 '
          + '규칙이라, 화면에서는 총딜 옆에 따로 적습니다.'));
      }
      inspector.append(el('p', 'bm-note-head', '사라짐 · 재생성'), windowEditor(part));
    }

    inspector.append(numberRow('가로', item.w, 4, 2000, (value) => { item.w = value; }, 'px'));
    inspector.append(numberRow('세로', item.h, 4, 2000, (value) => { item.h = value; }, 'px'));
    inspector.append(numberRow('기울기', item.rotation, -180, 180, (value) => {
      item.rotation = value;
    }, '°'));
    inspector.append(el('p', 'bm-note',
      '무대에서 도형 위쪽의 고리를 끌어도 돌아갑니다 — Shift를 누르면 15°씩 끊깁니다.'));
    if (!isPart(item.id)) {
      inspector.append(el('p', 'bm-note-head', '보이는 구간'), windowEditor(item));
    }

    // 도형별 적정거리 — 보스는 부위마다 거리가 다르다. 겨냥한 도형의 것이 걸린다.
    inspector.append(el('p', 'bm-note-head', '이 도형의 적정거리'));
    const rangeChips = el('div', 'bm-chips');
    for (const weapon of deps.settings.optimalRangeWeapons ?? deps.settings.weaponTypes) {
      const chip = el('button', 'bm-chip range', weapon);
      chip.type = 'button';
      if ((item.range ?? []).includes(weapon)) {
        chip.classList.add('is-on');
        chip.style.setProperty('--range', RANGE_COLOR[weapon] ?? '#8ea9c4');
      }
      chip.addEventListener('click', () => {
        const now = new Set(item.range ?? []);
        if (now.has(weapon)) now.delete(weapon); else now.add(weapon);
        if (now.size > 0) item.range = [...now].sort(); else delete item.range;
        save();
        render();
      });
      rangeChips.append(chip);
    }
    inspector.append(rangeChips);
    inspector.append(el('p', 'bm-note',
      '켠 무기군은 이 도형을 겨냥할 때 일반 공격에 +30%가 붙습니다. 도형 색이 그 무기군 '
      + '색이 되고, 여럿이면 섞인 색이 됩니다. 어느 도형에도 안 켜 두면 전투 조건에 직접 '
      + '잡아 둔 적정거리를 그대로 씁니다.'));
    inspector.append(el('p', 'bm-note',
      '도형을 겹쳐 놓아도 한 발이 여러 번 맞지 않습니다 — 관통 니케라도 마찬가지입니다. '
      + '계산기는 보스 하나를 상대하고 관통은 여러 «적»에게 걸리는 것이라, 겹친 자리는 '
      + '적정거리 무기군이 합쳐질 뿐 대미지가 두 번 들어가지 않습니다.'));

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

  /**
   * 보이는 구간 편집기. 구간을 **여럿** 둘 수 있다 — 깨졌다 되살아나기를 반복하는
   * 파츠와, 단계마다 나타났다 사라지는 도형이 그것으로 산다.
   *
   * 「지금 사라짐」은 마지막 구간의 끝을 커서로 당기고, 「지금 재생성」은 커서에서
   * 시작하는 구간을 새로 연다 — 재생하며 눈으로 맞추는 흐름 그대로다.
   */
  function windowEditor(item: BossShape): HTMLElement {
    const box = el('div', 'bm-windows');
    const duration = deps.currentBattle().duration;
    const list = item.windows ?? [];

    const commit = (next: Array<[number, number]>) => {
      const tidy = tidyWindows(next);
      if (tidy.length > 0) item.windows = tidy; else delete item.windows;
      save();
      render();
    };

    for (const [index, [from, to]] of list.entries()) {
      const row = el('div', 'bm-window');
      const spanFrom = el('input', 'bm-field tiny');
      spanFrom.type = 'number';
      spanFrom.value = String(round(from));
      const spanTo = el('input', 'bm-field tiny');
      spanTo.type = 'number';
      spanTo.value = String(round(to));
      const apply = () => {
        const next = list.map((pair, at) => (at === index
          ? [Number(spanFrom.value), Number(spanTo.value)] as [number, number] : pair));
        commit(next);
      };
      spanFrom.addEventListener('change', apply);
      spanTo.addEventListener('change', apply);
      const drop = el('button', 'bm-mini', '−');
      drop.type = 'button';
      drop.title = '이 구간 지우기';
      drop.addEventListener('click', () => commit(list.filter((_, at) => at !== index)));
      row.append(spanFrom, el('em', 'bm-unit', '~'), spanTo, el('em', 'bm-unit', '초'), drop);
      box.append(row);
    }
    if (list.length === 0) {
      box.append(el('p', 'bm-note', '구간이 없으면 처음부터 끝까지 보입니다.'));
    }

    const buttons = el('div', 'bm-when');
    for (const [label, make] of [
      ['지금 사라짐', (): Array<[number, number]> => {
        // 마지막 구간의 끝을 커서로 당긴다. 구간이 없으면 처음부터 지금까지로 만든다.
        if (list.length === 0) return [[0, round(cursor)]];
        return list.map((pair, at) => (at === list.length - 1
          ? [pair[0], round(cursor)] as [number, number] : pair));
      }],
      ['지금 재생성', (): Array<[number, number]> =>
        [...list, [round(cursor), duration] as [number, number]]],
      ['구간 추가', (): Array<[number, number]> =>
        [...list, [round(cursor), Math.min(duration, round(cursor) + 10)] as [number, number]]],
      ['전부 지우기', (): Array<[number, number]> => []],
    ] as Array<[string, () => Array<[number, number]>]>) {
      const button = el('button', 'bm-chip', label);
      button.type = 'button';
      button.addEventListener('click', () => commit(make()));
      buttons.append(button);
    }
    box.append(buttons);
    return box;
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

  /**
   * 니케별 «그 칸의 평타 딜».
   *
   * 칸의 총딜은 잘게 나눈 표가 들고 있고, 그 안에서 평타 몫을 갈라야 한다. 발수만으로
   * 나누면 한 발 무게가 다른 스킬 딜이 뒤섞이므로, **발수 × 한 발 평균**으로 무게를
   * 매겨 그 비로 칸의 총딜을 가른다 — 칸마다 다른 버프가 실린 총딜은 그대로 살아 있다.
   */
  function normalDamageByBucket(): Record<string, number[]> {
    const table = lastResult?.fineTimeline;
    const out: Record<string, number[]> = {};
    if (!table || !shots) return out;
    for (const name of deps.currentSquad().filter(Boolean)) {
      const total = table.damage[name] ?? [];
      const row = shots.chars[name];
      const breakdown = lastResult?.charBreakdown?.[name];
      if (!row || total.length === 0) continue;
      const avgNormal = breakdown && breakdown.normalHits > 0
        ? breakdown.normal / breakdown.normalHits : 0;
      const avgSkill = breakdown && breakdown.skillHits > 0
        ? breakdown.skill / breakdown.skillHits : 0;
      out[name] = total.map((damage, index) => {
        const weightNormal = (row.normal[index] ?? 0) * avgNormal;
        const weightSkill = (row.skill[index] ?? 0) * avgSkill;
        const sum = weightNormal + weightSkill;
        return sum > 0 ? damage * (weightNormal / sum) : 0;
      });
    }
    return out;
  }

  /** 지난 계산으로 낸 파괴 시각. 셈이 무거워 한 번 내고 들고 있는다. */
  let breakCache: PartBreak[] | null = null;

  /**
   * 파츠 파괴 시각. 한 판 돌린 뒤에는 **조준을 셈에 넣어** 낸다 —
   * 겨냥하지 않은 파츠는 탄이 들지 않으므로 깨지지 않는다.
   *
   * 돌리기 전에는 조준별 딜을 알 수 없어 스쿼드 총딜을 그대로 나눈 어림값을 쓴다.
   */
  function currentBreaks(): PartBreak[] {
    if (breakCache) return breakCache;
    const duration = deps.currentBattle().duration;
    if (!shots || !lastResult?.fineTimeline) {
      return partBreaks(design.parts, squadDps(), duration);
    }
    breakCache = aimedPartBreaks({
      parts: design.parts,
      bucket: shots.bucket,
      buckets: shots.buckets,
      normalDamage: normalDamageByBucket(),
      aimOf,
      spreadOf,
      modelN: accuracy?.modelN ?? 2.55,
    });
    return breakCache;
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
          // 적 코드가 잡혀 있으면 그 코드로 연다 — 철갑 보스의 속저는 철갑 속저다.
          const code = now.enemyCode || '풍압';
          deps.applyBattle({
            ...now,
            elementWindows: [...now.elementWindows, { from: start, to: start + 5, code }],
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

      // 니케별 탄착군 — 표가 기본값이고, 여기 적은 값이 그 위에 얹힌다.
      const spreads = el('div', 'bm-blast-rows');
      for (const name of squad) {
        const current = design.spread?.[name] ?? 0;
        const row = numberRow(name, current, 0, 2000, (value) => {
          const next = { ...(design.spread ?? {}) };
          if (value > 0) next[name] = value; else delete next[name];
          design.spread = next;
        }, 'px');
        const base = Math.round(spreadRadius(accuracy, weaponOf(name), 0) * 2);
        row.append(el('em', 'bm-cover', current > 0 ? `기본 ${base}` : `기본값 ${base}`));
        spreads.append(row);
      }
      battlePane.append(el('p', 'bm-note-head', '탄착군 지름'), spreads);
      battlePane.append(el('p', 'bm-note',
        `무기군 표의 기본값(${(deps.settings.optimalRangeWeapons ?? []).length > 0 ? 'AR 76 · SMG 110 · SG 240 · MG/SR/RL 10' : ''}px)을 `
        + '그대로 쓰다가, 0이 아닌 값을 적으면 그 니케만 그 지름으로 그립니다. 화면에만 '
        + '쓰이고 계산의 코어 명중률은 표의 값을 그대로 씁니다.'));
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
      const derived = {
        ...derivedEnemy(design, squadDps(), battle.duration),
        // 파괴 주기도 조준을 본 값이다 — 겨냥하지 않은 파츠는 깨지지 않으므로 주기도 없다.
        partBreakInterval: currentBreaks().find((entry) => entry.at !== null)?.at ?? 0,
      };
      const aimRange = derivedOptimalRange(design);
      // 관통이 꿰뚫는 수는 **지금 겨냥한 자리** 기준이다. 조준이 시각마다 달라지므로
      // 어느 자리로 쟀는지를 결과 줄에 함께 적는다.
      const aimNow = aimAt(design, cursor);
      const pierce = aimNow ? pierceTargets(design, aimNow, shots ? cursor : 0) : null;
      const request: SimulationRequest = {
        squad,
        characters: deps.currentCharacters(),
        duration: battle.duration,
        enemyDef: battle.enemyDef,
        enemyCode: battle.enemyCode,
        corePx: derived.corePx,
        hasParts: derived.hasParts,
        seed: battle.seed,
        // 도형에 적정거리를 걸어 뒀으면 **조준점이 놓인 도형**의 것이 이긴다.
        // 겹친 도형은 합집합이다 — 보너스는 무기군마다 한 번만 붙는다.
        optimalRangeWeapons: aimRange ?? battle.optimalRangeWeapons,
        immuneWindows: battle.immuneWindows,
        elementWindows: battle.elementWindows,
        rngMode: battle.rngMode,
        immuneBlocksBurst: battle.immuneBlocksBurst,
        normalHitCoeff: battle.normalHitCoeff,
        synchroLevel: battle.synchroLevel,
        burstRegenTime: battle.burstRegenTime,
        burstReaction: battle.burstReaction,
        console: battle.console,
        // 켜 둔 핵은 여기서도 그대로 걸린다 — 같은 조건인데 판마다 다른 수가 나오면
        // 어느 쪽이 진짜인지 알 수 없게 된다. 안 켰으면 이 키는 아예 빠진다.
        ...(hacksForRequest(battle.hacks) ? { hacks: battle.hacks! } : {}),
        ...(derived.partBreakInterval > 0
          ? { partBreakInterval: derived.partBreakInterval } : {}),
        ...(pierce && pierce.total > 1
          ? { piercePass: { shapes: Math.max(1, pierce.shapes), parts: pierce.parts } } : {}),
        shotTrack: true,
        // 누적 딜을 사격 트랙과 같은 0.1초 칸으로 읽으려면 잘게 나눈 표가 필요하다.
        fineTimeline: true,
      };
      const result = await deps.simulate(request);
      lastResult = result;
      shots = result.shots ?? null;
      states = result.states ?? null;
      impactCache = null;
      breakCache = null;      // 새로 잰 판이다 — 지난 자국을 이어 쓰면 안 된다
      buildCumulative(result);
      cursor = 0;
      setPlaying(false);
      // **여기서 나온 딜이 이 보스로 잰 딜이다.** 코어 직경·파츠 유무·파츠 파괴 시각이
      // 전부 그림에서 나온 값이라, 원래 창의 결과와 다를 수 있다 — 그래서 여기에 적는다.
      const dps = result.duration > 0 ? result.squadTotal / result.duration : 0;
      // 파괴 점수는 시뮬 밖에서 얹히는 값이다 — 총합에 더하되 얼마가 점수인지 함께 적는다.
      const score = scoreUntil(
        partBreaks(design.parts, dps, battle.duration), battle.duration,
      );
      const parts = [
        `${design.name} · ${squad.length}명 · ${result.duration}초`,
        score > 0
          ? `총합 ${formatDamage(result.squadTotal + score)}(딜 ${formatDamage(result.squadTotal)} + 파괴 점수 ${formatDamage(score)}) · ${formatDps(dps)}`
          : `총딜 ${formatDamage(result.squadTotal)} · ${formatDps(dps)}`,
        `${result.hitCount.toLocaleString('ko-KR')}발`,
        derived.corePx > 0 ? `코어 ${derived.corePx}px` : '코어 없음',
      ];
      if (derived.hasParts) parts.push('파츠');
      if (pierce && pierce.total > 1) {
        parts.push(`관통 ${pierce.total}중(몸통 ${pierce.shapes}·파츠 ${pierce.parts} · ${round(cursor)}초 조준 기준)`);
      }
      if (aimRange) {
        parts.push(aimRange.length > 0 ? `적정 ${aimRange.join('·')}` : '적정거리 없음(겨냥한 도형에 없음)');
      }
      // 파츠 파괴 시각은 «이 덱의 딜»에서 나오므로 **한 번 돌린 뒤에야** 알 수 있다.
      // 처음 돌릴 때는 넘길 값이 없었다는 사실을 숨기지 않고 적는다.
      // 파괴 시각은 이제 조준을 보고 낸다 — 방금 판으로 다시 내어 알려 준다.
      breakCache = null;
      const aimedFirst = currentBreaks().find((entry) => entry.at !== null);
      if (derived.partBreakInterval === 0 && aimedFirst?.at) {
        parts.push(`${aimedFirst.name}이(가) 약 ${round(aimedFirst.at)}초에 깨집니다 — 다시 돌리면 그 시각이 계산에 들어갑니다`);
      } else if (design.parts.length > 0 && !aimedFirst) {
        parts.push('이 조준으로는 깨지는 파츠가 없습니다');
      }
      runNote.textContent = parts.join(' · ');
      runNote.title = `총딜 ${Math.round(result.squadTotal).toLocaleString('ko-KR')}`
        + ` · 초당 ${Math.round(dps).toLocaleString('ko-KR')}`;
      render();
    } catch (error) {
      runNote.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
    }
  }

  /**
   * 접었다 펴는 묶음 머리. 줄이 열댓 개가 되면 다 볼 일이 없다 — 지금 보는 것만 편다.
   *
   * 접힌 상태는 그림이 아니라 **보는 방식**이라 저장본에 넣지 않는다(브라우저를 새로
   * 열면 다 펴진 채로 시작한다).
   */
  function groupHead(key: string, label: string, count: number): HTMLElement {
    const head = el('button', 'bm-group');
    head.type = 'button';
    const open = !folded.has(key);
    head.setAttribute('aria-expanded', String(open));
    head.append(el('i', open ? 'bm-group-mark is-open' : 'bm-group-mark'));
    head.append(el('span', 'bm-group-name', label));
    if (count > 0) head.append(el('em', 'bm-group-count', String(count)));
    head.addEventListener('click', () => {
      if (folded.has(key)) folded.delete(key); else folded.add(key);
      renderTracks();
    });
    return head;
  }

  function renderTracks() {
    tracks.replaceChildren();
    const battle = deps.currentBattle();
    const duration = battle.duration;

    // 시간 줄이 맨 위다 — 아래 줄들이 모두 이 시각을 기준으로 읽히기 때문이다.
    tracks.append(timeTrack(duration));

    tracks.append(aimTrack(duration));

    // 보스 상태 줄 — 족자·속저를 끌어 옮긴다.
    const stateCount = battle.immuneWindows.length + battle.elementWindows.length;
    tracks.append(groupHead('phase', '보스 상태 (족자 · 속저)', stateCount));
    if (!folded.has('phase')) {
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
      index, from: w.from, to: w.to, color: ELEMENT_COLOR[w.code] ?? '#8ab',
      label: w.code, code: w.code,
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

    }

    // 파츠마다 한 줄. 띠는 «보이는 구간»이라 끌면 사라짐·재생성 시각이 바뀌고,
    // 그 위의 표식은 «이쯤 깨진다»는 예상 시각이다.
    const breaks = currentBreaks();
    if (design.parts.length > 0) tracks.append(groupHead('parts', '파츠', design.parts.length));
    for (const [index, part] of (folded.has('parts') ? [] : design.parts).entries()) {
      const row = el('div', 'bm-track');
      const name = el('span', 'bm-track-name', part.name);
      name.title = `${part.name} · 체력 ${part.hp.toLocaleString('ko-KR')}`
        + ((part.score ?? 0) > 0 ? ` · 파괴 점수 ${part.score!.toLocaleString('ko-KR')}` : '');
      row.append(name);
      const lane = el('div', 'bm-lane');

      // 구간마다 띠 하나. 끌면 그 구간의 시각이 바뀐다.
      const windows = part.windows?.length ? part.windows : [[0, duration] as [number, number]];
      for (const [index, [from, to]] of windows.entries()) {
        const bar = el('div', 'bm-bar is-part');
        bar.style.left = `${(from / duration) * 100}%`;
        bar.style.width = `${(Math.max(0, to - from) / duration) * 100}%`;
        bar.style.setProperty('--bar', '#ffb347');
        bar.append(el('span', 'bm-bar-label', `${round(from)}–${round(to)}초`));
        const left = el('i', 'bm-bar-grip left');
        const right = el('i', 'bm-bar-grip right');
        bar.append(left, right);
        const drag = (event: PointerEvent, mode: 'move' | 'left' | 'right') => {
          event.preventDefault();
          event.stopPropagation();
          const box = lane.getBoundingClientRect();
          const at = (clientX: number) => ((clientX - box.left) / box.width) * duration;
          const grabbed = at(event.clientX);
          const onMove = (moveEvent: PointerEvent) => {
            const delta = at(moveEvent.clientX) - grabbed;
            let nextFrom = from;
            let nextTo = to;
            if (mode === 'move') { nextFrom = from + delta; nextTo = to + delta; }
            if (mode === 'left') nextFrom = Math.min(to - 0.5, from + delta);
            if (mode === 'right') nextTo = Math.max(from + 0.5, to + delta);
            nextFrom = Math.max(0, Math.min(duration, nextFrom));
            nextTo = Math.max(0.5, Math.min(duration, nextTo));
            bar.style.left = `${(nextFrom / duration) * 100}%`;
            bar.style.width = `${((nextTo - nextFrom) / duration) * 100}%`;
            const next = windows.map((pair, at2) => (at2 === index
              ? [round(nextFrom), round(nextTo)] as [number, number] : pair));
            part.windows = tidyWindows(next);
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            save();
            render();
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        };
        bar.addEventListener('pointerdown', (event) => drag(event, 'move'));
        left.addEventListener('pointerdown', (event) => drag(event, 'left'));
        right.addEventListener('pointerdown', (event) => drag(event, 'right'));
        // 두 번 누르면 그 구간만 지운다 — 구간이 하나뿐이면 «늘 보임»으로 돌아간다.
        bar.addEventListener('dblclick', () => {
          const next = (part.windows ?? []).filter((_, at2) => at2 !== index);
          if (next.length > 0) part.windows = next; else delete part.windows;
          save();
          render();
        });
        lane.append(bar);
      }

      const breakAt = breaks.find((entry) => entry.id === part.id)?.at ?? null;
      if (breakAt !== null) {
        const mark = el('i', 'bm-break');
        mark.style.left = `${(breakAt / duration) * 100}%`;
        mark.title = `${part.name} 파괴 — ${round(breakAt)}초`
          + ((part.score ?? 0) > 0 ? ` · +${part.score!.toLocaleString('ko-KR')}` : '');
        lane.append(mark);
      }
      row.append(lane);
      void index;
      tracks.append(row);
    }

    if (!shots) {
      tracks.append(el('p', 'bm-note',
        '「현재 덱으로 타임라인 구성」을 누르면 누가 언제 쏘는지, 그때 보스가 어떤 상태인지 이 자리에 펼칩니다.'));
      return;
    }

    // 니케별 사격 밀도. 오른쪽 끝에 **그 니케가 이 보스에게 넣은 딜**을 적는다.
    const totals = lastResult?.charTotals ?? {};
    const best = Math.max(1, ...Object.values(totals).map((value) => Number(value) || 0));
    const squadRows = shownSquad();
    if (squadRows.length > 0) tracks.append(groupHead('squad', '니케 사격', squadRows.length));
    for (const name of (folded.has('squad') ? [] : squadRows)) {
      const row = el('div', 'bm-track');
      const label = el('span', 'bm-track-name', name);
      const face = deps.imageOf(name);
      if (face) label.style.backgroundImage = `url(${face})`;
      row.append(label);
      const lane = el('div', 'bm-lane');
      lane.append(shotCanvas(name, duration));
      row.append(lane);
      const damage = Number(totals[name]) || 0;
      const value = el('span', damage >= best ? 'bm-track-dmg is-top' : 'bm-track-dmg',
        formatDamage(damage));
      // 짚어 보는 자리라 여기서는 **깎지 않은 숫자**를 적는다 — 억 단위로 접으면
      // 초당 100만이 「0.01억」이 되어 아무것도 읽히지 않는다.
      value.title = `${name} · ${Math.round(damage).toLocaleString('ko-KR')}`
        + ` · 초당 ${Math.round(damage / Math.max(1, duration)).toLocaleString('ko-KR')}`;
      row.append(value);
      tracks.append(row);
    }
    tracks.append(el('p', 'bm-note',
      '진한 칸일수록 그 순간에 많이 쏩니다. 노란 점은 확정 코어 명중, 붉은 점은 폭발입니다. '
      + '무대의 탄착점은 평타만 뿌립니다 — 스킬·버스트 딜은 조준 판정을 거치지 않고 그대로 맞습니다. '
      + '풀버스트가 아닐 때는 플레이어가 잡은 3번 칸 니케만 겨냥한 자리를 때리고, 나머지는 '
      + '자동 사격이라 보스 중앙을 때립니다. 풀버스트에 들어가면 다 같이 겨냥한 곳으로 몰립니다.'));
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

  /**
   * 시간 줄. 재생 단추와 눈금, 그리고 끌 수 있는 재생 헤드가 한 줄에 선다.
   *
   * 족자·속저와 **같은 자로 그린다** — 위아래가 같은 자리에서 같은 시각을 가리켜야
   * «이 구간에 누가 쏘고 있나»가 눈으로 이어진다.
   */
  function timeTrack(duration: number): HTMLElement {
    const row = el('div', 'bm-track time');

    const head = el('span', 'bm-track-name time');
    const play = el('button', 'bm-play');
    play.type = 'button';
    play.dataset.bmPlay = '';
    play.textContent = playing ? '❚❚' : '▶';
    play.title = playing ? '멈춤' : '재생';
    play.ariaLabel = play.title;
    play.disabled = shots === null;
    play.addEventListener('click', () => setPlaying(!playing));
    const rate = el('button', 'bm-rate', `×${speed}`);
    rate.type = 'button';
    rate.dataset.bmRate = '';
    rate.title = '재생 속도';
    rate.addEventListener('click', () => {
      speed = speed >= 8 ? 1 : speed * 2;
      renderTracks();
    });
    const clock = el('output', 'bm-clock', `${round(cursor)}초`);
    clock.dataset.bmClock = '';
    head.append(play, rate, clock);
    row.append(head);

    const lane = el('div', 'bm-lane time');
    lane.dataset.bmTimeLane = '';
    // 10초마다 눈금, 30초마다 숫자. 180초 판에서 이 정도가 읽힌다.
    for (let at = 0; at <= duration; at += 10) {
      const tick = el('i', at % 30 === 0 ? 'bm-tick major' : 'bm-tick');
      tick.style.left = `${(at / duration) * 100}%`;
      if (at % 30 === 0 && at > 0) tick.dataset.label = `${at}`;
      lane.append(tick);
    }
    const head2 = el('div', 'bm-playhead');
    head2.dataset.bmPlayhead = '';
    head2.style.left = `${(cursor / duration) * 100}%`;
    head2.tabIndex = 0;
    head2.setAttribute('role', 'slider');
    head2.setAttribute('aria-label', '타임라인 시각');
    head2.setAttribute('aria-valuemin', '0');
    head2.setAttribute('aria-valuemax', String(duration));
    head2.setAttribute('aria-valuenow', String(round(cursor)));
    head2.addEventListener('keydown', (event) => {
      const bucket = shots?.bucket ?? 0.1;
      const step = event.shiftKey ? 1 : bucket;
      if (event.key === 'ArrowLeft') { seek(cursor - step); event.preventDefault(); }
      if (event.key === 'ArrowRight') { seek(cursor + step); event.preventDefault(); }
      if (event.key === 'Home') { seek(0); event.preventDefault(); }
      if (event.key === 'End') { seek(duration); event.preventDefault(); }
    });
    lane.append(head2);

    // 줄 아무 데나 누르면 그 시각으로 간다. 누른 채 끌면 따라온다.
    const scrubTo = (clientX: number) => {
      const box = lane.getBoundingClientRect();
      seek(((clientX - box.left) / box.width) * duration);
    };
    lane.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      setPlaying(false);
      scrubTo(event.clientX);
      const onMove = (moveEvent: PointerEvent) => scrubTo(moveEvent.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    row.append(lane);
    return row;
  }

  /** 시각을 옮긴다. 무대만 다시 그린다 — 줄 전체를 다시 세우면 끌기가 끊긴다. */
  function seek(at: number) {
    const duration = deps.currentBattle().duration;
    cursor = Math.max(0, Math.min(duration, at));
    const head = host.querySelector<HTMLElement>('[data-bm-playhead]');
    if (head) {
      head.style.left = `${(cursor / duration) * 100}%`;
      head.setAttribute('aria-valuenow', String(round(cursor)));
    }
    const clock = host.querySelector<HTMLElement>('[data-bm-clock]');
    if (clock) clock.textContent = `${round(cursor)}초`;
    drawStage();
  }

  function setPlaying(on: boolean) {
    if (on && shots === null) return;      // 돌려 본 적이 없으면 흘릴 시간이 없다
    playing = on;
    const play = host.querySelector<HTMLButtonElement>('[data-bm-play]');
    if (play) {
      play.textContent = playing ? '❚❚' : '▶';
      play.title = playing ? '멈춤' : '재생';
      play.ariaLabel = play.title;
    }
    if (!playing) {
      cancelAnimationFrame(rafId);
      return;
    }
    // 끝에서 다시 누르면 처음부터 — 멈춘 자리에서 아무 일도 안 나면 고장으로 읽힌다.
    if (cursor >= deps.currentBattle().duration) seek(0);
    lastFrame = performance.now();
    rafId = requestAnimationFrame(step);
  }

  /** 한 프레임에 흘릴 수 있는 최대 시간(초). 아래 주석 참고. */
  const MAX_FRAME = 0.25;

  function step(now: number) {
    if (!playing) return;
    const duration = deps.currentBattle().duration;
    // 다른 탭에 갔다 오면 그 사이 프레임이 아예 안 온다(브라우저가 멈춘다). 그대로
    // 흘리면 돌아오는 순간 재생 헤드가 몇십 초를 건너뛴다 — 한 프레임 몫으로 자른다.
    const elapsed = Math.min(MAX_FRAME, (now - lastFrame) / 1000);
    seek(cursor + elapsed * speed);
    lastFrame = now;
    if (cursor >= duration) { setPlaying(false); return; }
    rafId = requestAnimationFrame(step);
  }

  /**
   * 조준 줄. 찍어 둔 키프레임이 점으로 서고, 끌어 시각을 옮긴다.
   *
   * 조준은 «어디를»과 «언제»가 따로 논다 — 자리는 무대에서 찍고, 시각은 여기서 민다.
   */
  function aimTrack(duration: number): HTMLElement {
    const row = el('div', 'bm-track');
    const head = el('span', 'bm-track-name aim');
    head.append(el('span', '', '조준'));
    const add = el('button', 'bm-mini', '+');
    add.type = 'button';
    add.title = '지금 시각에 조준 키프레임 찍기 — 누른 뒤 무대를 누르세요';
    add.addEventListener('click', () => {
      aimPicking = !aimPicking;
      add.classList.toggle('is-on', aimPicking);
      setHint(aimPicking ? '무대를 눌러 이 시각의 조준점을 찍으세요.' : '');
    });
    head.append(add);
    row.append(head);

    const lane = el('div', 'bm-lane');
    for (const key of [...(design.aimKeys ?? [])].sort((a, b) => a.t - b.t)) {
      const dot = el('i', Math.abs(key.t - cursor) < 0.05 ? 'bm-aim-mark is-on' : 'bm-aim-mark');
      dot.style.left = `${(key.t / duration) * 100}%`;
      dot.title = `${round(key.t)}초 · (${key.x}, ${key.y}) — 끌어 옮기고, 두 번 누르면 지웁니다`;
      dot.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const box = lane.getBoundingClientRect();
        const onMove = (moveEvent: PointerEvent) => {
          const t = round(Math.max(0, Math.min(duration,
            ((moveEvent.clientX - box.left) / box.width) * duration)));
          key.t = t;
          dot.style.left = `${(t / duration) * 100}%`;
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          design.aimKeys = [...(design.aimKeys ?? [])].sort((a, b) => a.t - b.t);
          impactCache = null;
          save();
          render();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      dot.addEventListener('dblclick', () => {
        design.aimKeys = (design.aimKeys ?? []).filter((entry) => entry !== key);
        impactCache = null;
        save();
        render();
      });
      lane.append(dot);
    }
    row.append(lane);
    return row;
  }

  interface PhaseBar {
    index: number;
    from: number;
    to: number;
    color: string;
    label: string;
    /** 속저 줄만 — 이 구간의 속성. 있으면 띠 안에서 바꿀 수 있다 */
    code?: ElementCode;
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
      if (bar.code !== undefined) {
        // 속저는 속성을 바꿀 수 있어야 한다. 띠 안에 드롭다운을 넣고, 그 위에서
        // 시작된 누르기는 끌기로 넘기지 않는다(고르는 중에 띠가 딸려 간다).
        const pick = el('select', 'bm-bar-code');
        for (const code of ELEMENT_CODES) {
          const option = el('option', '', code);
          option.value = code;
          pick.append(option);
        }
        pick.value = bar.code;
        pick.addEventListener('pointerdown', (event) => event.stopPropagation());
        pick.addEventListener('click', (event) => event.stopPropagation());
        pick.addEventListener('change', () => {
          const now = deps.currentBattle();
          const next = [...now.elementWindows];
          next[bar.index] = { ...next[bar.index]!, code: pick.value as ElementCode };
          deps.applyBattle({ ...now, elementWindows: next });
          render();
        });
        node.append(pick);
      }
      node.append(el('span', 'bm-bar-label', `${round(bar.from)}–${round(bar.to)}초`));
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

  /** 잘게 나눈 딜 표(없으면 1초 표)로 앞자리 합을 만든다. 계산이 끝날 때 한 번만 돈다. */
  function buildCumulative(result: SimulationResult) {
    const table = result.fineTimeline ?? result.timeline;
    cumulative = {};
    cumulativeBucket = table?.bucket ?? 1;
    for (const [name, row] of Object.entries(table?.damage ?? {})) {
      const sums = new Array<number>(row.length);
      let running2 = 0;
      for (let at = 0; at < row.length; at += 1) {
        running2 += row[at] ?? 0;
        sums[at] = running2;
      }
      cumulative[name] = sums;
    }
  }

  /** 커서가 선 자리까지 그 니케가 넣은 딜. 지나간 칸까지만 센다. */
  function damageUntil(name: string): number {
    const sums = cumulative[name];
    if (!sums || sums.length === 0) return 0;
    const at = Math.min(sums.length - 1, Math.floor(cursor / cumulativeBucket) - 1);
    return at < 0 ? 0 : sums[at]!;
  }

  /**
   * 무대 오른쪽 위 — 지금까지 넣은 딜.
   *
   * 타임라인 오른쪽 끝의 숫자가 «판 전체»라면 이쪽은 «여기까지»다. 재생하면서 누가
   * 언제부터 벌기 시작하는지가 이 판에서 읽힌다.
   */
  function renderHud() {
    const squad = shownSquad();
    if (shots === null || squad.length === 0) { hud.hidden = true; return; }
    hud.hidden = false;
    hud.replaceChildren();

    const rows = squad.map((name) => ({ name, damage: damageUntil(name) }));
    const dealt = rows.reduce((sum, row) => sum + row.damage, 0);
    const best = Math.max(1, ...rows.map((row) => row.damage));
    // 파츠를 깨서 얹힌 점수. 시뮬이 때려서 낸 값이 아니라 출처가 달라 따로 적는다.
    const score = scoreUntil(currentBreaks(), cursor);
    const total = dealt + score;

    const head = el('div', 'bm-hud-total');
    head.append(el('b', '', formatDamage(total)));
    head.append(el('span', '', `${round(cursor)}초까지`));
    head.title = `${Math.round(total).toLocaleString('ko-KR')}`
      + (score > 0 ? ` (딜 ${Math.round(dealt).toLocaleString('ko-KR')} + 파괴 점수 ${Math.round(score).toLocaleString('ko-KR')})` : '');
    hud.append(head);
    if (score > 0) {
      const line = el('div', 'bm-hud-row is-score');
      line.append(el('span', 'bm-hud-tag', '파괴 점수'), el('span', 'bm-hud-dmg', formatDamage(score)));
      line.title = `깨진 파츠의 점수 합 ${Math.round(score).toLocaleString('ko-KR')}`;
      hud.append(line);
    }

    for (const row of rows) {
      const line = el('div', row.damage >= best ? 'bm-hud-row is-top' : 'bm-hud-row');
      const face = el('i', 'bm-buff-face');
      const image = deps.imageOf(row.name);
      if (image) face.style.backgroundImage = `url(${image})`;
      else face.textContent = row.name.slice(0, 1);
      line.append(face, el('span', 'bm-hud-dmg', formatDamage(row.damage)));
      line.title = `${row.name} · ${Math.round(row.damage).toLocaleString('ko-KR')}`;
      hud.append(line);
    }
  }

  /** 버스트 연출이 머무는 시간(초). 짧게 스치고 사라진다. */
  const FLASH_SECONDS = 1.5;

  /**
   * 버스트를 쓰는 순간의 작은 연출 — [초상화] 3버 · 화무십일홍 · 만개.
   *
   * **애니메이션을 이벤트로 쏘지 않고 커서에서 되짚는다.** 지나간 시각과의 차이로
   * 밝기·자리를 정하므로, 재생하다 멈춰도 방금 쓴 버스트가 그대로 떠 있고 뒤로 끌면
   * 되감긴 것처럼 보인다. 이벤트로 쏘면 스크럽할 때 안 뜨거나 한꺼번에 터진다.
   *
   * 1버→2버→3버는 0.6초 안에 잇따르므로 여럿이 동시에 뜬다 — 아래에서 위로 쌓는다.
   */
  function renderFlash() {
    flash.replaceChildren();
    const casts = lastResult?.timeline?.bursts;
    if (shots === null || !casts) return;

    const live: Array<{ name: string; cast: BurstCast; age: number }> = [];
    for (const [name, list] of Object.entries(casts)) {
      if (hidden.has(name)) continue;
      for (const cast of list) {
        const age = cursor - cast.t;
        if (age < 0 || age > FLASH_SECONDS) continue;
        live.push({ name, cast, age });
      }
    }
    // 갓 쓴 것이 아래(눈에 가까운 자리)에 오도록 오래된 것부터 붙인다.
    live.sort((left, right) => right.age - left.age);

    for (const { name, cast, age } of live.slice(-4)) {
      const chip = el('div', 'bm-flash-chip');
      // 들어올 때 0.18초 동안 떠오르고, 마지막 0.45초 동안 위로 빠지며 사라진다.
      const rise = Math.min(1, age / 0.18);
      const leave = Math.max(0, (age - (FLASH_SECONDS - 0.45)) / 0.45);
      const lift = (1 - rise) * 10 + leave * 14;
      chip.style.opacity = (Math.min(rise, 1 - leave)).toFixed(2);
      chip.style.transform = `translateY(${lift.toFixed(1)}px) scale(${(0.94 + rise * 0.06).toFixed(3)})`;

      const face = el('i', 'bm-buff-face');
      const image = deps.imageOf(name);
      if (image) face.style.backgroundImage = `url(${image})`;
      else face.textContent = name.slice(0, 1);
      chip.append(face);
      if (cast.stage) chip.append(el('b', 'bm-flash-stage', `${cast.stage}버`));
      chip.append(el('span', 'bm-flash-name', cast.skill || `${name} 버스트`));
      flash.append(chip);
    }
  }

  /** 무한 장탄의 센티널. 엔진이 999999로 둔다(`timeline.py`). */
  const AMMO_INFINITE = 99_999;

  /**
   * 무대 오른쪽 아래 — 캐릭터별 상태. 초상화 · 남은 탄/전체 · 지금 무엇을 하고 있나.
   *
   * 상태는 계산이 남긴 기록에서 읽는다: 재장전 구간에 들었으면 「재장전」, 그 칸에 쏜
   * 발이 있으면 「사격」, 풀버스트 구간이면 「버스트」, 아무것도 아니면 「대기」다.
   * **기절은 다루지 않는다** — 보스 sim에는 아군을 기절시키는 것이 없다.
   */
  function renderStates() {
    const squad = shownSquad();
    if (!states || squad.length === 0) { statePanel.hidden = true; return; }
    statePanel.hidden = false;
    statePanel.replaceChildren();

    const index = Math.min(states.buckets - 1, Math.floor(cursor / states.bucket));
    const burstNow = fullBurstNow(cursor);
    for (const name of squad) {
      const row = states.chars[name];
      if (!row) continue;
      const line = el('div', 'bm-state-row');
      const face = el('i', 'bm-buff-face');
      const image = deps.imageOf(name);
      if (image) face.style.backgroundImage = `url(${image})`;
      else face.textContent = name.slice(0, 1);
      line.append(face);

      // 무한인지는 **그때그때의 값**으로 가른다. 「한 번이라도 무한이었나」로 보면
      // 8초짜리 버스트(나유타 「기억 연소」)가 끝난 뒤에도 ∞로 남는다.
      const ammo = row.ammo[index] ?? 0;
      const infinite = ammo >= AMMO_INFINITE;
      const clip = el('span', 'bm-state-ammo');
      clip.append(el('b', ammo === 0 ? 'is-empty' : '', infinite ? '∞' : String(ammo)));
      if (!infinite && row.maxAmmo > 0) clip.append(el('em', '', `/${row.maxAmmo}`));
      line.append(clip);

      const reloading = row.reload.some(([from, to]) => cursor >= from && cursor < to);
      const shooting = ((shots?.chars[name]?.normal[index] ?? 0)
        + (shots?.chars[name]?.skill[index] ?? 0)) > 0;
      const [mark, mood] = reloading ? ['재장전', 'reload']
        : burstNow ? ['버스트', 'burst']
        : shooting ? ['사격', 'fire'] : ['대기', 'idle'];
      line.append(el('span', `bm-state-mark is-${mood}`, mark));
      line.title = `${name} · ${infinite ? '무한 장탄' : `${ammo}${row.maxAmmo > 0 ? `/${row.maxAmmo}` : ''}발`} · ${mark}`;
      statePanel.append(line);
    }
  }

  /** 니케 걸러 보기. 초상화를 눌러 끄면 무대·타임라인·버프에서 함께 빠진다. */
  function renderFilter() {
    const squad = deps.currentSquad().filter(Boolean);
    filterBar.hidden = squad.length === 0;
    filterBar.replaceChildren();
    for (const [index, name] of squad.entries()) {
      const chip = el('button', hidden.has(name) ? 'bm-face is-off' : 'bm-face');
      chip.type = 'button';
      chip.title = hidden.has(name) ? `${name} 보이기` : `${name} 감추기`;
      chip.ariaLabel = chip.title;
      chip.setAttribute('aria-pressed', String(!hidden.has(name)));
      chip.style.setProperty('--who', AIM_COLORS[index % AIM_COLORS.length]!);
      const face = deps.imageOf(name);
      if (face) chip.style.backgroundImage = `url(${face})`;
      else chip.textContent = name.slice(0, 2);
      chip.addEventListener('click', () => {
        if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
        impactCache = null;
        render();
      });
      filterBar.append(chip);
    }
    if (hidden.size > 0) {
      const all = el('button', 'bm-face-all', '전부 보기');
      all.type = 'button';
      all.addEventListener('click', () => {
        hidden.clear();
        impactCache = null;
        render();
      });
      filterBar.append(all);
    }
  }

  /**
   * 지금 이 순간 걸려 있는 버프 — [시전자] 버프 이름 [받는 사람].
   *
   * 타임라인이 들고 온 버프 구간에서 커서가 든 것만 고른다. 구간마다 받는 사람이
   * 갈리는 버프가 있어(리버렐리오 「차분한 수심」처럼 공격력 순으로 대상이 바뀐다)
   * 줄 전체의 대상이 아니라 **그 구간의 대상**을 읽는다(`spanTargets`).
   */
  function renderBuffs() {
    const tracks2 = lastResult?.timeline?.buffs ?? [];
    buffBar.replaceChildren();
    if (shots === null || tracks2.length === 0) { buffBar.hidden = true; return; }
    buffBar.hidden = false;

    const face = (name: string): HTMLElement => {
      const node = el('i', 'bm-buff-face');
      const image = deps.imageOf(name);
      if (image) node.style.backgroundImage = `url(${image})`;
      else node.textContent = name.slice(0, 1);
      node.title = name;
      return node;
    };

    let shown = 0;
    for (const track of tracks2) {
      const span = track.spans.find(([from, to]) => cursor >= from && cursor < to);
      if (!span) continue;
      const targets = spanTargets(track, span).filter((name) => !hidden.has(name));
      if (hidden.has(track.caster) && targets.length === 0) continue;
      if (targets.length === 0) continue;
      shown += 1;
      const stack = span[2];
      const row = el('span', 'bm-buff');
      // 기둥이 좁아 긴 이름은 잘린다 — 올려 두면 누가 누구에게 건 무엇인지 다 나온다.
      row.title = `${track.caster} → ${track.name}${stack > 1 ? ` ×${stack}` : ''}`
        + ` · 받는 사람 ${targets.join(', ')}`;
      row.append(face(track.caster));
      const label = el('b', 'bm-buff-name', track.name);
      if (stack > 1) label.append(el('em', 'bm-buff-stack', `×${stack}`));
      row.append(label);
      const to = el('span', 'bm-buff-targets');
      for (const target of targets) to.append(face(target));
      row.append(to);
      buffBar.append(row);
    }
    if (shown === 0) {
      buffBar.append(el('span', 'bm-buff-none', `${round(cursor)}초 — 걸려 있는 버프가 없습니다`));
    }
  }

  /**
   * 레이어 목록. 무대에서 겹친 것을 짚어 고르고, 그리는 차례를 바꾼다.
   *
   * **아래에 적힌 것이 위에 그려진다**(나중에 그린 것이 위다). 목록은 그 반대로
   * 세운다 — 사람이 「맨 위」라고 부르는 것이 목록에서도 맨 위여야 한다.
   */
  function renderLayers() {
    layerBox.replaceChildren();
    const items = allItems();
    if (items.length === 0) {
      layerBox.append(el('p', 'bm-layers-empty', '아직 아무것도 없습니다.'));
      return;
    }
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]!;
      const part = isPart(item.id);
      const row = el('div', 'bm-layer' + (selectedId === item.id ? ' is-on' : ''));
      row.dataset.bmLayer = item.id;
      const pick = el('button', 'bm-layer-pick');
      (pick as HTMLButtonElement).type = 'button';
      const swatch = el('i', 'bm-layer-dot');
      swatch.style.background = part ? '#ffb347' : item.color;
      pick.append(swatch, el('span', '', part ? (item as BossPart).name : SHAPE_LABEL[item.kind]));
      pick.addEventListener('click', () => {
        selectedId = item.id;
        render();
      });
      row.append(pick);
      // 순서 바꾸기. 파츠와 도형은 서로 다른 목록에 살아 제 목록 안에서만 오간다.
      for (const [delta, label] of [[1, '▲'], [-1, '▼']] as const) {
        const move = el('button', 'bm-layer-move');
        (move as HTMLButtonElement).type = 'button';
        move.textContent = label;
        (move as HTMLButtonElement).title = delta > 0 ? '위로' : '아래로';
        const list = part ? design.parts : design.shapes;
        const at = list.findIndex((other) => other.id === item.id);
        const to = at + delta;
        (move as HTMLButtonElement).disabled = to < 0 || to >= list.length;
        move.addEventListener('click', () => {
          const moved = list.splice(at, 1)[0]!;
          list.splice(to, 0, moved);
          save();
          render();
        });
        row.append(move);
      }
      layerBox.append(row);
    }
  }

  function render() {
    renderPicker();
    renderFilter();
    nameInput.value = design.name;
    narrow.hidden = window.innerWidth >= MIN_WIDTH;
    drawStage();
    renderLayers();
    renderInspector();
    renderBattle();
    renderTracks();
  }

  nameInput.addEventListener('input', () => {
    design.name = nameInput.value;
    save();
    renderPicker();
  });
  const redrawImpacts = () => { impactCache = null; drawStage(); };
  showAim.addEventListener('change', drawStage);
  showHits.addEventListener('change', redrawImpacts);
  pileHits.addEventListener('change', redrawImpacts);
  // 창을 닫으면 재생도 멈춘다 — 안 보이는 화면을 60프레임으로 다시 그릴 이유가 없다.
  // 안내는 한 번 닫으면 다시 안 띄운다 — 같은 말을 매번 읽히는 것은 안내가 아니라 소음이다.
  const CALLOUT_KEY = 'nikke-boss-callout-hidden';
  const callout = q<HTMLElement>('.bm-callout');
  try {
    callout.hidden = deps.storage()?.getItem(CALLOUT_KEY) === '1';
  } catch {
    /* 저장소를 못 읽으면 그냥 보여 준다 */
  }
  q<HTMLButtonElement>('[data-bm-callout-close]').addEventListener('click', () => {
    callout.hidden = true;
    try {
      deps.storage()?.setItem(CALLOUT_KEY, '1');
    } catch {
      /* 저장 못 해도 이번 창에서는 닫힌 채로 둔다 */
    }
  });

  // 피드백 창은 이 화면 바깥에 있다 — 창을 닫고 그쪽을 연다.
  const feedbackButton = q<HTMLButtonElement>('[data-bm-feedback]');
  feedbackButton.hidden = deps.openFeedback === undefined;
  feedbackButton.addEventListener('click', () => {
    close();
    deps.openFeedback?.();
  });

  const helpPane = q<HTMLElement>('[data-bm-help]');
  q<HTMLButtonElement>('[data-bm-help-open]').addEventListener('click', () => {
    helpPane.hidden = false;
  });
  q<HTMLButtonElement>('[data-bm-help-close]').addEventListener('click', () => {
    helpPane.hidden = true;
  });
  helpPane.addEventListener('click', (event) => {
    if (event.target === helpPane) helpPane.hidden = true;
  });
  q<HTMLButtonElement>('[data-bm-run]').addEventListener('click', () => { void runTimeline(); });
  q<HTMLButtonElement>('[data-bm-close]').addEventListener('click', () => { close(); });
  q<HTMLButtonElement>('[data-bm-new]').addEventListener('click', () => {
    save();
    const fresh = emptyDesign(`보스 ${library.designs.length + 1}`);
    library = putDesign(library, fresh);
    design = fresh;
    selectedId = null;
    shots = null;
    save();
    render();
  });
  q<HTMLButtonElement>('[data-bm-copy]').addEventListener('click', () => {
    save();
    library = copyDesign(library, design.id);
    design = activeDesign(library);
    selectedId = null;
    save();
    render();
  });
  // 공들여 그린 보스가 한 번의 오누름으로 사라지지 않게 두 번 묻는다.
  confirmTwice(q<HTMLButtonElement>('[data-bm-drop]'), () => {
    // 마지막 하나는 지워도 빈 판이 남는다 — 다룰 것이 없는 화면은 만들지 않는다.
    library = dropDesign(library, design.id);
    design = activeDesign(library);
    selectedId = null;
    shots = null;
    save();
    render();
  });
  picker.addEventListener('change', () => openDesign(picker.value));

  // ── 공유 ────────────────────────────────────────────────────────────────
  const sharePane = q<HTMLElement>('[data-bm-share]');
  const shareOut = q<HTMLTextAreaElement>('[data-bm-share-out]');
  const shareIn = q<HTMLTextAreaElement>('[data-bm-share-in]');
  const shareMsg = q<HTMLElement>('[data-bm-share-msg]');
  const setShareMsg = (message: string, ok = false) => {
    shareMsg.textContent = message;
    shareMsg.hidden = message === '';
    shareMsg.classList.toggle('is-ok', ok);
  };
  /**
   * 서버 공유. 조합·전투 조건과 **같은 판**을 쓴다 — 올리기·목록·코드 세 탭이 그대로 선다.
   * 서버 주소가 없는 빌드에서는 탭을 아예 안 그리고 코드 주고받기만 남는다.
   */
  const sharePanel: SharePanel | null = deps.shareServer ? mountSharePanel(
    {
      tabs: q<HTMLElement>('[data-bm-share-tabs]'),
      upload: q<HTMLElement>('[data-bm-share-pane="upload"]'),
      list: q<HTMLElement>('[data-bm-share-pane="list"]'),
      code: q<HTMLElement>('[data-bm-share-pane="code"]'),
    },
    {
      kind: 'maker',
      server: deps.shareServer,
      current: () => ({
        code: encodeBossCode(design),
        auto: bossSummary(),
      }),
      apply: (item) => { receiveCode(item.code, item.name); },
      notify: setShareMsg,
    },
  ) : null;

  /** 목록에 한 줄로 적히는 설명. 무엇을 그린 보스인지 숫자로 요약한다. */
  function bossSummary(): string {
    const parts = [
      `도형 ${design.shapes.length}`,
      `파츠 ${design.parts.length}`,
      design.core ? `코어 ${Math.round(design.core.d)}px` : '코어 없음',
    ];
    if ((design.aimKeys ?? []).length > 0) parts.push(`조준 ${design.aimKeys!.length}`);
    const ranged = [...design.shapes, ...design.parts]
      .flatMap((shape) => shape.range ?? []);
    if (ranged.length > 0) parts.push(`적정 ${[...new Set(ranged)].sort().join('·')}`);
    return parts.join(' · ');
  }

  /** 받은 코드를 새 저장본으로 들인다. 코드 칸과 목록이 같은 길을 쓴다. */
  function receiveCode(code: string, label?: string) {
    // 받은 것은 **새 저장본**으로 들인다 — 지금 그리던 것을 덮어쓰면 되돌릴 길이 없다.
    const received = decodeBossCode(code, Object.keys(deps.settings.characters));
    if (label) received.name = label.slice(0, 24);
    save();
    library = putDesign(library, received);
    design = received;
    selectedId = null;
    shots = null;
    impactCache = null;
    save();
    render();
    setShareMsg(`「${received.name}」을(를) 새 저장본으로 받았습니다.`, true);
  }

  q<HTMLButtonElement>('[data-bm-share-open]').addEventListener('click', () => {
    sharePane.hidden = !sharePane.hidden;
    if (!sharePane.hidden) {
      shareOut.value = encodeBossCode(design);
      setShareMsg('');
      sharePanel?.open();
    }
  });
  q<HTMLButtonElement>('[data-bm-share-copy]').addEventListener('click', () => {
    shareOut.select();
    void navigator.clipboard?.writeText(shareOut.value)
      .then(() => setShareMsg('코드를 복사했습니다.', true))
      .catch(() => setShareMsg('복사하지 못했습니다 — 코드를 직접 선택해 복사해 주세요.'));
  });
  q<HTMLButtonElement>('[data-bm-share-apply]').addEventListener('click', () => {
    try {
      receiveCode(shareIn.value);
      shareIn.value = '';
    } catch (error) {
      setShareMsg(error instanceof Error ? error.message : String(error));
    }
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
    setPlaying(false);
    host.hidden = true;
    document.body.classList.remove('bm-open');
    deps.onClose?.();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !host.hidden) close();
  });

  return { open, close };
}
