/**
 * 딜량 보고서 HTML 렌더러 (`report.ts` 전용, 파이썬 `report_html.py`의 이식).
 *
 * 자체완결 HTML을 만든다 — 이미지는 base64 인라인, CSS·JS도 인라인이라 파일 하나만 있으면 어디서든 열린다.
 * 색은 dataviz 스킬 레퍼런스 팔레트(검증본)를 그대로 쓴다.
 * 캐릭터 색은 **스쿼드 자리 순서**로 고정 배정한다 (딜 순위로 칠하지 않는다).
 */

import * as char_spec from '../../../../site/src/engine/spec';
import type { Deviation } from '../../../../site/src/engine/spec';
import {
  _is_float, _mark_float, _py_eq, _py_fmt_g, _py_is_dict, _py_str,
} from '../../../../site/src/engine/customization';
import { get, sum, truthy, tupleKey } from '../../../../site/src/engine/py';
import { loadEngine } from './engine_env';
import { img_index, portraits } from './images';
import { load_profile } from './profile';
import type { GrowthProfile } from './profile';
import { dumps, esc, fmt, isSystemExit, nowMinute } from './pycompat';
import { REPORT_DEFAULT_CONFIG } from './report';

// 카드 썸네일 한 변 (px). 원본은 256×512 세로형이라 위쪽 정사각형만 잘라 쓴다.
const _THUMB = 150;

const g = (x: number): string => _py_fmt_g(x);

// ── 숫자 표기 ─────────────────────────────────────────────────────────────

/** 딜량 표기 — 억 단위 소수점 둘째 자리. 100만 미만은 원 수치. */
export function _kor(n: number): string {
  if (Math.abs(n) >= 1e6) return `${fmt(n / 1e8, ',.2f')}억`;
  return fmt(n, ',.0f');
}

export function _pct(x: number): string {
  return `${fmt(x, '.1f')}%`;
}

export const _esc = esc;

// ── CSS ───────────────────────────────────────────────────────────────────

export const _CSS = `
:root {
  color-scheme: light;
  --surface: #fcfcfb; --plane: #f9f9f7;
  --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --good: #006300; --bad: #d03b3b; --warn: #a06a00;
  --seq: #2a78d6; --seq-soft: #cde2fb;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface: #1a1a19; --plane: #0d0d0d;
    --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --good: #0ca30c; --bad: #d03b3b; --warn: #eda100;
    --seq: #3987e5; --seq-soft: #184f95;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px 24px 80px;
  background: var(--plane); color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
  font-size: 14px; line-height: 1.55;
}
.wrap { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
h2 { font-size: 16px; margin: 40px 0 14px; letter-spacing: -0.01em; }
h3 { font-size: 14px; margin: 0 0 10px; }
.sub { color: var(--ink2); margin: 0 0 18px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chip {
  border: 1px solid var(--border); border-radius: 999px;
  padding: 3px 10px; font-size: 12px; color: var(--ink2); background: var(--surface);
}
.boss {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 9px 13px; font-size: 12.5px; color: var(--ink2);
  font-variant-numeric: tabular-nums;
}
/* 운용 조건 — 접지 않는다. 총딜만 보고 "기준 그대로 돌린 결과"로 오해하는 걸 막는 장치다. */
.ops {
  margin-top: 8px; border-radius: 10px; padding: 9px 13px; font-size: 12.5px;
  background: var(--surface); border: 1px solid var(--border); color: var(--ink2);
}
.ops.has-exc {
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  border-color: color-mix(in srgb, var(--warn) 40%, transparent);
}
.ops b { color: var(--ink); margin-right: 8px }
.ops.has-exc .exc-head b { color: var(--warn) }
.ops .base2 { color: var(--muted); margin-top: 2px }
.ops .exc-head { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--border) }
.ops ul { margin: 4px 0 0; padding-left: 18px }
.ops li { margin: 2px 0 }
.ops li > b { color: var(--ink) }
/* 설정 칩. 상단 블록과 케이스 카드가 같은 형식을 쓴다 — 두 곳에 같은 줄이 나오지는 않지만
   형식이 다르면 같은 종류의 정보로 안 읽힌다. */
.cat {
  display: inline-block; margin: 0 4px 0 8px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; color: var(--ink2); white-space: nowrap;
  background: var(--grid); border: 1px solid var(--border);
}
.scope { color: var(--muted) }
.boss b { color: var(--ink); margin-right: 8px; }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 16px;
}
.tabs { display: flex; gap: 4px; margin: 18px 0 0; border-bottom: 1px solid var(--border); }
.tab {
  appearance: none; background: none; border: none; cursor: pointer;
  font: inherit; font-size: 13.5px; color: var(--ink2);
  padding: 9px 16px; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tab:hover { color: var(--ink); }
.tab.on { color: var(--ink); font-weight: 640; border-bottom-color: var(--seq); }
.panel > h2:first-of-type { margin-top: 26px; }
/* 케이스 요약: 한 줄에 한 케이스 — 왼쪽 스쿼드, 오른쪽 수치 */
.cases { display: flex; flex-direction: column; gap: 12px; }
.caserow { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; }
.casehead { flex: 0 0 100%; }              /* 이름·설명은 카드 폭 전체 */
.caseleft { flex: 0 0 290px; min-width: 0; }
.caseright { flex: 1; min-width: 0; }
.case-name { font-weight: 650; font-size: 15px; }
.case-note { color: var(--ink2); font-size: 12.5px; margin-top: 2px; }
/* 이 케이스에만 걸린 설정. 상단 운용 조건 블록과 같은 칩 형식이되 여기서만 보인다. */
.caseops {
  margin-top: 6px; font-size: 12px; color: var(--ink2); line-height: 1.9;
  padding: 2px 8px 2px 4px;
  border-left: 2px solid color-mix(in srgb, var(--warn) 55%, transparent);
}
.caseops .cat:first-child { margin-left: 4px }
.squad { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
@media (max-width: 820px) {
  .caserow { flex-direction: column; align-items: stretch; gap: 14px; }
  .caseleft { flex: none; }
}
.port { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.port .pic, .port .noimg {
  width: 100%; aspect-ratio: 1 / 1; background-size: cover; background-position: center;
  border-radius: 8px; border: 1px solid var(--border); display: block;
}
.port .noimg { background: var(--grid); }
.port span {
  font-size: 9.5px; color: var(--ink2); text-align: center; line-height: 1.2;
  overflow-wrap: anywhere;
}
.hero { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.hero b { font-size: 30px; font-weight: 660; letter-spacing: -0.02em; }
.hero .pm { color: var(--ink2); font-size: 13px; }
.delta { font-size: 13px; font-weight: 600; }
.up { color: var(--good); } .down { color: var(--bad); } .flat { color: var(--muted); }
.kv { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px;
      font-size: 12px; color: var(--ink2); font-variant-numeric: tabular-nums; }
.rowlab { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
.rowlab .r { color: var(--ink2); font-variant-numeric: tabular-nums; }
.stackwrap { margin: 6px 0 8px; }
.stack { display: flex; height: 26px; border-radius: 5px; overflow: hidden;
         background: var(--grid); gap: 2px; }
.seg { display: flex; align-items: center; justify-content: center; min-width: 0;
       font-size: 11px; color: #fff; font-variant-numeric: tabular-nums; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--ink2); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px;
            margin-right: 5px; vertical-align: -1px; }
details { border-top: 1px solid var(--border); }
details > summary {
  cursor: pointer; padding: 10px 2px; font-size: 13px; color: var(--ink2);
  list-style: none; user-select: none;
}
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: "▸ "; color: var(--muted); }
details[open] > summary::before { content: "▾ "; }
details > summary:hover { color: var(--ink); }
.detail-body { padding: 4px 2px 18px; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px;
        font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 5px 8px; border-bottom: 1px solid var(--grid); }
th:first-child, td:first-child { text-align: left; }
th { color: var(--muted); font-weight: 500; white-space: nowrap; }
.charhead { display: flex; align-items: center; gap: 10px; }
.charhead .mini { width: 30px; height: 30px; border-radius: 6px; flex: none;
                  background-size: cover; background-position: center;
                  border: 1px solid var(--border); }
.dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
pre { background: var(--plane); border: 1px solid var(--border); border-radius: 8px;
      padding: 10px 12px; overflow-x: auto; font-size: 11.5px; color: var(--ink2); margin: 0; }
.foot { color: var(--muted); font-size: 12px; margin-top: 36px; }
#tip {
  position: fixed; z-index: 99; pointer-events: none; opacity: 0;
  background: var(--surface); color: var(--ink); border: 1px solid var(--border);
  border-radius: 8px; padding: 7px 10px; font-size: 12px; white-space: pre;
  box-shadow: 0 6px 20px rgba(0,0,0,0.16); transition: opacity .08s;
  font-variant-numeric: tabular-nums;
}
`;

const _JS = `
(function () {
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (o) { o.classList.remove('on'); });
      t.classList.add('on');
      document.querySelectorAll('.panel').forEach(function (p) {
        p.hidden = (p.id !== t.dataset.panel);
      });
    });
  });

  var tip = document.getElementById('tip');
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest('[data-tip]');
    if (!el) return;
    tip.textContent = el.getAttribute('data-tip');
    tip.style.opacity = 1;
  });
  document.addEventListener('mousemove', function (e) {
    if (tip.style.opacity != 1) return;
    var x = e.clientX + 14, y = e.clientY + 16;
    var r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 16;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-tip]')) tip.style.opacity = 0;
  });
})();
`;

// ── 조각 렌더러 ───────────────────────────────────────────────────────────

// 랩쳐 속성 → 그 속성이 약점으로 맞는 공격 속성
const _CODE_WEAK: Record<string, string> = { 전격: '철갑', 수냉: '전격', 작열: '수냉', 풍압: '작열', 철갑: '풍압' };

/** 랩쳐 설정 한 줄 요약. 미지정 항목은 timeline.DEFAULT_ENEMY 기본값. */
export function _enemy_desc(enemy: Record<string, any> | null): string {
  const e = truthy(enemy) ? enemy! : {};
  const code = get(e, 'code');
  const parts = [truthy(code) ? `코드 ${_py_str(code)}(약점 ${_CODE_WEAK[code] ?? '?'})` : '코드 없음'];
  const has_def = Object.prototype.hasOwnProperty.call(e, 'def');
  parts.push(`방어력 ${fmt(has_def ? e['def'] : 31784, ',', has_def && _is_float(e, 'def'))}`);
  const core = get(e, 'core_px', 0);
  parts.push(truthy(core) ? `코어 ${g(core)}px` : '코어 없음');
  parts.push(truthy(get(e, 'has_parts')) ? '파츠 있음' : '파츠 없음');
  if (truthy(get(e, 'optimal_range_weapons'))) parts.push('적정거리 ' + (e['optimal_range_weapons'] as string[]).join(', '));
  return parts.join(' · ');
}

// 캐릭터명 → CSS 클래스. 같은 캐릭터가 여러 케이스·탭에 나와도 이미지 데이터는 한 번만 인라인된다.
export const _IMG_CLASS = new Map<string, string>();

/** 등장하는 캐릭터 이미지를 CSS 클래스로 한 번씩만 정의한다. */
export function _img_css(names: string[]): string {
  _IMG_CLASS.clear();
  const uniq = [...new Set(names)];
  const idx = img_index();
  const paths = uniq.map((nm) => idx.get(_normName(nm)) ?? null);
  const reqs = paths.filter((p): p is string => p !== null)
    .map((p) => ({ path: p, size: _THUMB, quality: 82, always: false }));
  const got = portraits(reqs);
  const byPath = new Map<string, ReturnType<typeof portraits>[number]>();
  reqs.forEach((r, i) => byPath.set(r.path, got[i]!));
  const rules: string[] = [];
  uniq.forEach((nm, i) => {
    const p = paths[i];
    const img = p ? byPath.get(p) : null;
    if (!img) return;
    const cls = `im${i}`;
    _IMG_CLASS.set(nm, cls);
    // 원본을 그대로 넣었을 때(파이썬·Pillow 없음)만 위치를 덧붙여 CSS로 자른다.
    const pos = img.posY === null ? '' : `;background-position:50% ${fmt(img.posY, '.2f')}% !important`;
    rules.push(`.${cls}{background-image:url(${img.src})${pos}}`);
  });
  return rules.join('\n');
}

function _normName(s: string): string {
  return s.replace(/ /g, '').replace(/:/g, '').replace(/_/g, '').toLowerCase();
}

export function _squad_strip(names: string[]): string {
  const cells: string[] = [];
  for (const nm of names) {
    const cls = _IMG_CLASS.get(nm);
    const img = cls ? `<div class="pic ${cls}" role="img" aria-label="${esc(nm)}"></div>`
      : '<div class="noimg" title="이미지 없음"></div>';
    cells.push(`<div class="port">${img}<span>${esc(nm)}</span></div>`);
  }
  for (let i = names.length; i < 5; i += 1) cells.push('<div class="port"></div>');
  return `<div class="squad">${cells.join('')}</div>`;
}

/** 이 집계에 분산 정보가 있는가 (기대값 모드·1회 실행이면 감춘다). */
function _spread(st: Record<string, any>): boolean {
  return get(st, 'n', 0) > 1;
}

/** 케이스 요약 카드 1장. */
function _case_card_impl(c: Record<string, any>, show_name: boolean, ops = ''): string {
  const t = c['total'];
  let tip: string; let spread_html: string; let range_html: string;
  if (_spread(t)) {
    tip = `${c['name']}\n평균 ${_kor(t['mean'])}\n표준편차 ${_kor(t['std'])} (${fmt(t['cv'], '.2f')}%)\n`
      + `최소 ${_kor(t['min'])}\n최대 ${_kor(t['max'])}\nn=${t['n']}회`;
    spread_html = `<span class="pm">± ${_kor(t['std'])} (${fmt(t['cv'], '.2f')}%)</span>`;
    range_html = `<span>범위 ${_kor(t['min'])} ~ ${_kor(t['max'])}</span>`;
  } else {
    tip = `${c['name']}\n기대딜 ${_kor(t['mean'])}\n난수 없음 (기대값 모드)`;
    spread_html = '';
    range_html = '';
  }
  let head = '';
  if (show_name) head += `<div class="case-name">${esc(c['name'])}</div>`;
  if (truthy(c['note'])) head += `<div class="case-note">${esc(c['note'])}</div>`;
  head += ops;
  head = head ? `<div class="casehead">${head}</div>` : '';

  return `
<div class="card caserow">
  ${head}
  <div class="caseleft">
    ${_squad_strip(c['squad'])}
  </div>
  <div class="caseright">
  <div class="hero" data-tip="${esc(tip)}">
    <b>${_kor(t['mean'])}</b>
    ${spread_html}
  </div>
  <div class="kv">
    ${range_html}
    <span>${fmt(c['duration'], '.0f')}초 · 풀버스트 ${fmt(c['burst_count'], '.0f')}회</span>
  </div>
  </div>
</div>`;
}

/**
 * 갈아끼울 수 있는 조각 — 파이썬에서는 `report_ref.py`가 모듈 함수 `_case_card`를 바꿔 끼웠다.
 * ES 모듈 export는 다시 대입할 수 없으므로 이 객체의 칸을 바꾼다.
 */
export const hooks = {
  case_card: _case_card_impl,
};

export function _case_card(c: Record<string, any>, show_name: boolean, ops = ''): string {
  return _case_card_impl(c, show_name, ops);
}

/** (캐릭터, 색) 목록을 딜 내림차순으로. 색은 스쿼드 자리 순서로 배정한 뒤 함께 들고 다닌다. */
function _by_damage(c: Record<string, any>): Array<[Record<string, any>, string]> {
  const pairs: Array<[Record<string, any>, string, number]> = c['chars'].map(
    (ch: any, i: number) => [ch, `var(--s${i + 1})`, i]);
  pairs.sort((a, b) => (-a[0]['mean']) - (-b[0]['mean']) || a[2] - b[2]);
  return pairs.map(([ch, col]) => [ch, col]);
}

/** 캐릭터 기여 스택. 막대 전체 길이는 케이스 총딜에 비례한다 (최고 케이스 = 100%). */
function _contrib_block(c: Record<string, any>, hi: number): string {
  const total = sum(c['chars'].map((ch: any) => ch['mean'])) || 1;
  const segs: string[] = []; const legend: string[] = [];
  for (const [ch, color] of _by_damage(c)) {
    const share = ch['mean'] / total * 100;
    let tip = `${ch['name']}\n${_kor(ch['mean'])} (${fmt(share, '.1f')}%)`;
    if (_spread(ch)) tip += `\n±${_kor(ch['std'])} (CV ${fmt(ch['cv'], '.2f')}%)`;
    segs.push(`<div class="seg" style="flex:${fmt(share, '.4f')} 0 0; background:${color}" `
      + `data-tip="${esc(tip)}"></div>`);
    legend.push(`<span><i style="background:${color}"></i>${esc(ch['name'])} ${_kor(ch['mean'])}</span>`);
  }
  const width = hi ? total / hi * 100 : 100;
  return `
  <div style="margin-bottom:18px">
    <div class="rowlab"><span><b>${esc(c['name'])}</b></span>
      <span class="r">${_kor(c['total']['mean'])}</span></div>
    <div class="stackwrap"><div class="stack" style="width:${fmt(width, '.3f')}%">${segs.join('')}</div></div>
    <div class="legend">${legend.join('')}</div>
  </div>`;
}

function _char_detail(c: Record<string, any>): string {
  const total = sum(c['chars'].map((ch: any) => ch['mean'])) || 1;
  const blocks: string[] = [];
  for (const [ch, color] of _by_damage(c)) {
    const share = ch['mean'] / total * 100;
    const cls = _IMG_CLASS.get(ch['name']);
    const img = cls ? `<span class="mini ${cls}"></span>` : '';
    const ct = ch['mean'] || 1;
    const rows = (ch['skills'] as any[]).map((s) =>
      `<tr><td>${esc(s['name'])}</td>`
      + `<td>${_kor(s['damage'])}</td>`
      + `<td>${fmt(s['damage'] / ct * 100, '.1f')}%</td>`
      + `<td>${fmt(s['hits'], '.1f')}</td></tr>`).join('');
    const fb_sum = ch['fb_self'] + ch['fb_other'] + ch['non_fb'] || 1;
    const spreadTxt = _spread(ch) ? ` · ±${_kor(ch['std'])} (CV ${fmt(ch['cv'], '.2f')}%)` : '';
    blocks.push(`
    <details>
      <summary>
        <span class="charhead">
          <span class="dot" style="background:${color}"></span>${img}
          <b>${esc(ch['name'])}</b>
          <span>${_kor(ch['mean'])} · ${fmt(share, '.1f')}%${spreadTxt}</span>
        </span>
      </summary>
      <div class="detail-body">
        <div class="kv">
          <span>기본공격 ${_pct(ch['normal'] / ct * 100)} (${_kor(ch['normal'])})</span>
          <span>스킬 ${_pct(ch['skill'] / ct * 100)} (${_kor(ch['skill'])})</span>
          <span>풀버스트(본인) ${_pct(ch['fb_self'] / fb_sum * 100)}</span>
          <span>풀버스트(타인) ${_pct(ch['fb_other'] / fb_sum * 100)}</span>
          <span>비풀버스트 ${_pct(ch['non_fb'] / fb_sum * 100)}</span>
        </div>
        <table>
          <thead><tr><th>대미지 출처</th><th>평균 딜</th><th>캐릭 내 비중</th>
            <th>히트수</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`);
  }
  return `
<details>
  <summary><b>${esc(c['name'])}</b> — 캐릭터별 딜 상세 (${c['chars'].length}명)</summary>
  <div class="detail-body">${blocks.join('')}</div>
</details>`;
}

function _raw_table(cases: Array<Record<string, any>>, seeds: Array<number | null>): string {
  if (seeds.length <= 1) return '';
  const head = seeds.map((s) => `<th>${s === null ? '랜덤' : `seed ${s}`}</th>`).join('');
  const rows = cases.map((c) => {
    const cells = (c['runs'] as any[]).map((r) => `<td>${_kor(r['squad_total'])}</td>`).join('');
    return `<tr><td>${esc(_full_name(c))}</td>${cells}`
      + `<td><b>${_kor(c['total']['mean'])}</b></td>`
      + `<td>${_kor(c['total']['std'])}</td></tr>`;
  });
  return `
<details>
  <summary>회차별 원자료 표</summary>
  <div class="detail-body">
    <table><thead><tr><th>케이스</th>${head}<th>평균</th><th>표준편차</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>
  </div>
</details>`;
}

// ── 운용 조건 (기준 + 예외) ────────────────────────────────────────────────

const _OPT_LABEL: Record<string, string> = {
  element_bonus: '우월코드', atk_pct: '공격력', max_ammo_pct: '최대장탄',
  crit_rate: '크리티컬 확률', crit_dmg: '크리티컬 피해',
  charge_speed_pct: '차지속도', charge_dmg_pct: '차지대미지',
  accuracy_pct: '명중률', def_pct: '방어력',
};

const _SPEC_LABEL: Record<string, string> = {
  level: '레벨', breakthrough: '돌파', core_enhancement: '코어 강화',
  affinity: '호감도', collection_stage: '컬렉션', favorite_stage: '애장품 단계',
  weapon_mode_swap: '무기 변경 모드', 'cube.name': '큐브', 'cube.level': '큐브 레벨',
  'skill_levels.1': '스킬1 레벨', 'skill_levels.2': '스킬2 레벨', 'skill_levels.3': '스킬3 레벨',
  'console.common_level': '공용 콘솔', 'console.class_level': '클래스 콘솔',
  'console.company_level': '회사 콘솔',
};

/** 파이썬 `context/spec._fmt` — 이탈 값 표기(사전은 `{k=v, ...}`, 빈 사전은 `없음`). */
function _spec_fmt(v: any, isFloat = false): string {
  if (_py_is_dict(v)) {
    return truthy(v)
      ? '{' + Object.entries(v).map(([k, x]) => `${k}=${_spec_fmt(x, _is_float(v, k))}`).join(', ') + '}'
      : '없음';
  }
  return _py_str(v, isFloat);
}

/** 오버로드 옵션 값 → 표시 문자열. 단계가 섞인 리스트면 합계와 구성을 함께 적는다. */
function _opt_value_text(v: any, isFloat = false): string {
  if (Array.isArray(v)) {
    if (!v.length) return '없음';
    const counts = new Map<number, number>();
    for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
    if (counts.size === 1) return `${g(sum(v))}%`;
    const detail = [...counts].map(([val, n]) => (n > 1 ? `${g(val)}%×${n}` : `${g(val)}%`)).join(' + ');
    return `${g(sum(v))}% (${detail})`;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return `${g(Number(v))}%`;
  return _py_str(v, isFloat);
}

const _HOLD_LABEL: Record<string, string> = { own_full_burst: '버스트 중 차지 유지', charge_hold_after_fb: '버스트 후 차지 홀드' };
const _RELOAD_LABEL: Record<string, string> = { before_fb_end: '버스트 종료 전 재장전', into_fb: '버스트로 끌고 들어가기' };

const _CAT_ORDER: Record<string, number> = { 컨트롤: 0, 버스트순서: 1, '버스트 충전': 2, 전투: 3, 옵션: 4, 육성: 5 };

/** `control.<정책>` 한 덩어리 → 사람이 읽는 한 줄. */
function _control_text(sub: string, cur: any, isFloat = false): string {
  const v: Record<string, any> = _py_is_dict(cur) ? cur : {};
  if (cur === '없음') {
    return ({ tap_fire: '톡톡이 없음', reload: '장전컨 없음', cover: '엄폐컨 없음', hold: '홀드 없음' } as
      Record<string, string>)[sub] ?? `${sub} 없음`;
  }
  const pol = (): string => { const p = get(v, 'policy'); return _py_str(p); };
  if (sub === 'tap_fire') {
    let out = `톡톡이 ${g(get(v, 'rate', 0))}회/초`;
    if (!_py_eq(get(v, 'release', 0.03), 0.03)) out += ` (떼기 ${g(v['release'])}초)`;
    if (truthy(get(v, 'full_charge_interval'))) out += ` · 풀차지 ${g(v['full_charge_interval'])}초마다`;
    return out;
  }
  if (sub === 'reload') {
    let out = '장전컨 — ' + (_RELOAD_LABEL[get(v, 'policy')] ?? pol());
    if (get(v, 'policy') === 'before_fb_end' && !_py_eq(get(v, 'lead', 0.3), 0.3)) out += ` (종료 ${g(v['lead'])}초 전)`;
    else if (get(v, 'policy') === 'into_fb' && !_py_eq(get(v, 'margin', 0.1), 0.1)) out += ` (시작 ${g(v['margin'])}초 뒤 완료)`;
    if (truthy(get(v, 'if_dry'))) out += ' · 비버스트에 마를 때만';
    return out;
  }
  if (sub === 'cover') return '버스트 엄폐컨';
  if (sub === 'hold') return '홀드 — ' + (_HOLD_LABEL[get(v, 'policy')] ?? pol());
  if (sub === 'sequence') return `명시 조작 시퀀스 ${Array.isArray(cur) ? cur.length : 0}건`;
  return `${sub} ${_spec_fmt(cur, isFloat)}`;
}

/** 이탈 한 줄 → (카테고리, 문구). 바뀐 값만 적는다. */
function _dev_item(key: string, cur: any, isFloat = false): [string, string] {
  if (key === 'burst_pattern') return ['버스트순서', cur !== '없음' ? _py_str(cur, isFloat) : '패턴 없음 (왼쪽부터)'];
  if (key === 'burst_regen_time') return ['버스트 충전', `${g(cur)}초`];
  if (key.startsWith('control.')) return ['컨트롤', _control_text(key.split('.').slice(1).join('.'), cur, isFloat)];
  if (key.startsWith('equip_skills.')) {
    const k = key.split('.').slice(1).join('.');
    const lab = _OPT_LABEL[k] ?? k;
    if (_py_eq(cur, 0) || cur === '없음' || (Array.isArray(cur) && cur.length === 0)) return ['옵션', `${lab} 없음`];
    return ['옵션', `${lab} ${_opt_value_text(cur, isFloat)}`];
  }
  const lab = _SPEC_LABEL[key] ?? key;
  if (typeof cur === 'boolean') return ['육성', cur ? lab : `${lab} 없음`];
  return ['육성', `${lab} ${_spec_fmt(cur, isFloat)}`];
}

/** config에 직접 준 버스트 패턴 → 짧은 운용 문구. */
export function _burst_pattern_text(pattern: any): string {
  if (typeof pattern === 'string') {
    if (pattern.startsWith('every:')) return `${pattern.split(':').slice(1).join(':')}의 배수 사이클`;
    return pattern;
  }
  if (!Array.isArray(pattern) || !pattern.length) return _py_str(pattern);
  const last = pattern[pattern.length - 1];
  const range = (a: number, b: number, step = 1): number[] => {
    const out: number[] = [];
    if (typeof b !== 'number') return out;
    for (let x = a; x < b; x += step) out.push(x);
    return out;
  };
  if (typeof last === 'number' && _py_eq(pattern, range(2, last + 1))) return '첫 사이클 제외';
  if (typeof last === 'number' && _py_eq(pattern, range(2, last + 1, 2))) return '짝수 사이클';
  return pattern.map((x) => _py_str(x)).join(', ') + '번째 사이클';
}

const _profile_cache = new Map<string, GrowthProfile>();

/** 보고서가 육성 프로필로 계산됐으면 그 프로필(이탈 보고 기준선). 못 읽으면 null. */
function _profile(spec: Record<string, any>): GrowthProfile | null {
  const name = get(spec, 'profile');
  if (!truthy(name)) return null;
  if (_profile_cache.has(name)) return _profile_cache.get(name)!;
  try {
    const p = load_profile(name, true);
    _profile_cache.set(name, p);
    return p;
  } catch (e) {
    if (isSystemExit(e)) return null;
    throw e;
  }
}

function _base_line(spec: Record<string, any> | null = null): string {
  const d = char_spec._DEFAULT_CHAR();
  const head = `컨트롤 자동 · 버스트순서 왼쪽부터 · 버스트 충전 ${g(d['burst_regen_time'])}초`;
  if (spec && truthy(get(spec, 'profile'))) return head;
  const eq = d['equip_skills'];
  const keys = [...Object.keys(_OPT_LABEL), ...Object.keys(eq).filter((k) => !(k in _OPT_LABEL))];
  const opts = keys.filter((k) => truthy(get(eq, k))).map((k) => `${_OPT_LABEL[k] ?? k} ${g(eq[k])}%`).join(' / ');
  return `${head} · 옵션 ${opts}`;
}

function _spec_line(spec: Record<string, any> | null = null): string {
  if (spec && truthy(get(spec, 'profile'))) {
    return '육성은 캐릭터마다 프로필 값 — 공통 기준 없음. '
      + "캐릭터별 실제 육성은 아래 '실행 설정'에서 본다.";
  }
  const d = char_spec._DEFAULT_CHAR();
  const lv = d['skill_levels'];
  const s = (o: any, k: string): string => _py_str(o[k], _is_float(o, k));
  const equipment = ['머리', '몸통', '팔', '다리'].map((p) => s(d['equipment'][p], 'level')).join('/');
  return `육성 레벨 ${s(d, 'level')} · ${s(d, 'breakthrough')}돌 · 호감도 ${s(d, 'affinity')} · `
    + `스킬 ${s(lv, '1')}/${s(lv, '2')}/${s(lv, '3')} · 장비 ${equipment} · `
    + `${s(d['cube'], 'name')} ${s(d['cube'], 'level')} · ${s(d, 'collection_stage')}`;
}

function _chip(cat: string, text: string): string {
  return `<span class="cat">${cat}</span>${esc(text)}`;
}

// ── 시뮬 설정(`config`) → 같은 칩 형식 ──────────────────────────────────────

/** 전개된 `burst_sequence` → "2버 홀수 A / 짝수 B" 같은 한 줄. 기본 순서면 null. */
export function _seq_text(squad: string[], seq: Array<Record<string, any>>): string | null {
  if (!seq || !seq.length) return null;
  let p = 1;
  for (; p <= seq.length; p += 1) {
    let ok = true;
    for (let i = 0; i < seq.length; i += 1) if (!_py_eq(seq[i], seq[i % p])) { ok = false; break; }
    if (ok) break;
  }
  const cycle = seq.slice(0, p);
  const labels = p === 2 ? ['홀수', '짝수'] : Array.from({ length: p }, (_, i) => `${i + 1}번째`);

  const parts: string[] = [];
  const stages = [...new Set(cycle.flatMap((e) => Object.keys(e)))].sort();
  for (const stage of stages) {
    const lists: string[][] = cycle.map((e) => [...((truthy(get(e, stage)) ? e[stage] : []) as string[])]);
    if (!lists.some((x) => x.length)) continue;
    const dflt = squad.filter((n) => [stage, 'A'].includes(char_spec.burst_stage(n)));
    if (lists.every((x) => _py_eq(x, dflt))) continue;
    const sets = new Set(lists.map((x) => [...new Set(x)].sort().join('\u0000')));
    const head_only = sets.size === 1 && lists[0]!.length > 1;
    const shown = lists.map((x) => (head_only ? x.slice(0, 1) : x));
    let body: string;
    if (shown.every((x) => _py_eq(x, shown[0]))) body = shown[0]!.join(' → ');
    else body = shown.map((x, i) => `${labels[i]} ${x.join(' → ')}`).join(' / ');
    parts.push(`${stage}버 ${body}`);
  }
  return parts.join(' · ') || null;
}

/** 케이스 `config` 중 기본값과 다른 것 → (카테고리, 문구) 목록. */
function _config_items(squad: string[], cfg: Record<string, any>, base: Record<string, any>,
  burst_count = 0.0): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'burst_pattern') continue;
    if (k === 'burst_sequence') {
      const t = _seq_text(squad, v);
      if (t) out.push(['버스트순서', t]);
    } else if (k === 'no_burst_char' && truthy(v)) {
      out.push(['버스트순서', `${_py_str(v)} 버스트 미사용`]);
    } else if (_py_eq(v, get(base, k))) {
      continue;
    } else if (k === 'duration') out.push(['전투', `${g(v)}초`]);
    else if (k === 'first_burst_time') out.push(['전투', `첫 버스트 ${g(v)}초`]);
    else if (k === 'burst_switch_delay') out.push(['전투', `단계 전환 ${g(v)}초`]);
    else if (k === 'max_burst_count' && v <= burst_count) out.push(['전투', `풀버스트 최대 ${g(v)}회`]);
  }
  return out;
}

/** 운용 조건 → (상단 블록, {케이스 이름: 케이스 카드에 얹을 줄}). */
export function _ops(spec: Record<string, any>, cases: Array<Record<string, any>>): [string, Map<string, string>] {
  // (주체, 카테고리, 문구) → 이 설정이 걸린 케이스 이름들. 주체는 캐릭터명 또는 "공통".
  const seen = new Map<string, { key: [string, string, string]; where: string[] }>();
  const add = (subj: string, kt: [string, string], cname: string): void => {
    const k = tupleKey(subj, kt[0], kt[1]);
    if (!seen.has(k)) seen.set(k, { key: [subj, kt[0], kt[1]], where: [] });
    seen.get(k)!.where.push(cname);
  };
  const appears = new Map<string, Set<string>>();
  const appear = (s: string, cname: string): void => {
    if (!appears.has(s)) appears.set(s, new Set());
    appears.get(s)!.add(cname);
  };
  for (const c of cases) {
    const cname: string = c['name'];
    appear('공통', cname);
    for (const nm of c['squad']) appear(nm, cname);

    for (const kt of _config_items(c['squad'], c['config'], REPORT_DEFAULT_CONFIG, get(c, 'burst_count', 0.0))) {
      add('공통', kt, cname);
    }

    const squad = (c['squad'] as string[]).map((nm) => _char_of(spec, c, nm));
    const devs = char_spec.squad_deviations(squad.filter((s) => truthy(s)), _profile(spec));

    for (const [nm, pattern] of Object.entries((get(c['config'], 'burst_pattern') || {}) as Record<string, any>)) {
      const ch = _char_of(spec, c, nm);
      if (truthy(get(ch, 'burst_pattern'))) continue;
      add(nm, ['버스트순서', _burst_pattern_text(pattern)], cname);
    }
    // 케이스 전원에게 똑같이 걸린 설정은 스쿼드 단위로 접는다.
    const per_case = new Map<string, { kt: [string, string]; n: number }>();
    const itemOf = (row: Deviation): [string, string] => _dev_item(row[0], row[2], (row._float ?? [false, false])[1]);
    for (const items of devs.values()) {
      for (const row of items) {
        const kt = itemOf(row);
        const k = tupleKey(...kt);
        if (!per_case.has(k)) per_case.set(k, { kt, n: 0 });
        per_case.get(k)!.n += 1;
      }
    }
    const nsq = c['squad'].length;
    const squad_wide = new Set([...per_case].filter(([, x]) => x.n === nsq && nsq > 1).map(([k]) => k));
    for (const k of squad_wide) add('공통', per_case.get(k)!.kt, cname);
    for (const [nm, items] of devs) {
      for (const row of items) {
        const kt = itemOf(row);
        if (!squad_wide.has(tupleKey(...kt))) add(nm, kt, cname);
      }
    }
  }

  // 주체가 나온 케이스 전부에 걸렸으면 상단, 일부에만 걸렸으면 그 케이스 카드로.
  const common = new Map<string, Array<[number, string]>>();
  const per = new Map<string, Array<[number, string]>>();
  for (const { key: [subj, cat, text], where } of seen.values()) {
    const rank = _CAT_ORDER[cat] ?? 9;
    const ap = appears.get(subj) ?? new Set<string>();
    const whereSet = new Set(where);
    if ([...ap].every((x) => whereSet.has(x))) {
      if (!common.has(subj)) common.set(subj, []);
      common.get(subj)!.push([rank, _chip(cat, text)]);
    } else {
      const chip = subj === '공통' ? _chip(cat, text)
        : `${_chip(cat, text)} <span class="scope">— ${esc(subj)}</span>`;
      for (const cname of new Set(where)) {
        if (!per.has(cname)) per.set(cname, []);
        per.get(cname)!.push([rank, chip]);
      }
    }
  }

  const _sorted = (parts: Array<[number, string]>): string =>
    parts.map((p, i) => ({ p, i })).sort((a, b) => a.p[0] - b.p[0] || a.i - b.i).map((x) => x.p[1]).join('');

  let base = `<div><b>기준</b>${esc(_base_line(spec))}</div>`
    + `<div class="base2">${esc(_spec_line(spec))}</div>`;
  if (truthy(get(spec, 'profile_header'))) {
    const notes = ((get(spec, 'profile_notes') || []) as string[])
      .map((n) => `<div class="base2">⚠ ${esc(n)}</div>`).join('');
    base = `<div><b>⚠ 육성 프로필</b>${esc(spec['profile_header'])}</div>${notes}${base}`;
  }
  let top: string;
  if (common.size) {
    const rows = [...common].map(([s, p]) => `<li><b>${esc(s)}</b>${_sorted(p)}</li>`).join('');
    top = `<div class="ops has-exc">${base}`
      + '<div class="exc-head"><b>⚠ 기준과 다른 설정</b>'
      + '— 아래는 나온 케이스 전부에서 이렇게 계산됐다.</div>'
      + `<ul>${rows}</ul></div>`;
  } else if (per.size) {
    top = `<div class="ops">${base}`
      + '<div class="base2">케이스마다 다른 설정은 각 케이스에 적었다.</div></div>';
  } else {
    top = `<div class="ops">${base}<div class="base2">예외 없음 — 전원 기준 그대로.</div></div>`;
  }
  const perOut = new Map<string, string>();
  for (const [cname, p] of per) perOut.set(cname, `<div class="caseops">${_sorted(p)}</div>`);
  return [top, perOut];
}

function _config_block(spec: Record<string, any>, cases: Array<Record<string, any>>): string {
  const parts = [`<h3 style='margin-top:8px'>공통 육성 기본값</h3><pre>`
    + `${esc(dumps(spec['defaults'], { indent: 2 }))}</pre>`];
  for (const c of cases) {
    const chars_diff: Record<string, any> = {};
    for (const ch of c['chars']) {
      const full = _char_of(spec, c, ch['name']);
      const diff: Record<string, any> = {};
      for (const [k, v] of Object.entries(full)) {
        if (k !== 'name' && !_py_eq(v, get(spec['defaults'], k))) {
          diff[k] = v;
          _mark_float(diff, k, _is_float(full, k));
        }
      }
      if (truthy(diff)) chars_diff[ch['name']] = diff;
    }
    const body: Record<string, any> = { config: c['config'], enemy: c['enemy'] };
    if (truthy(chars_diff)) body['육성 오버라이드'] = chars_diff;
    parts.push(`<h3 style='margin-top:14px'>${esc(_full_name(c))}</h3>`
      + `<pre>${esc(dumps(body, { indent: 2 }))}</pre>`);
  }
  return `
<details>
  <summary>실행 설정 (육성·버스트·랩쳐)</summary>
  <div class="detail-body">${parts.join('')}</div>
</details>`;
}

/** 스펙 원본에서 해당 케이스·캐릭터의 전개된 육성 dict를 찾는다 ((name, variant) 쌍으로). */
function _char_of(spec: Record<string, any>, c: Record<string, any>, char_name: string): Record<string, any> {
  for (const sc of spec['cases']) {
    if (sc['name'] === c['name'] && get(sc, 'variant', '') === get(c, 'variant', '')) {
      for (const ch of sc['squad']) if (ch['name'] === char_name) return ch;
    }
  }
  return {};
}

function _full_name(c: Record<string, any>): string {
  return truthy(get(c, 'variant')) ? `${c['name']} — ${c['variant']}` : c['name'];
}

// ── 진입점 ────────────────────────────────────────────────────────────────

export function render_html(spec: Record<string, any>, cases: Array<Record<string, any>>,
  seeds: Array<number | null>, random_seed: boolean, expected = false): string {
  loadEngine();
  const now = nowMinute();
  const n = seeds.length;
  const seed_txt = random_seed ? '매 회차 랜덤 시드' : '';
  const foot_txt = expected
    ? '크리·코어히트를 확률 판정 대신 기대값으로 계산해 난수가 없다 — 케이스당 1회로 '
      + '같은 수치가 재현되고, 케이스 간 차이는 전부 실제 차이다. 인게임 한 판은 이 값 '
      + '주위로 흩어진다(총딜 기준 표준편차 0.2~0.6% 남짓).'
    : '시드를 고정하면 같은 스펙에서 같은 수치가 재현된다. 표준편차는 시드 간 편차이며, '
      + '스킬 상세의 히트수는 회차 평균이라 소수점이 나온다.';

  const chips = [
    `케이스 ${cases.length}개`,
    expected ? '기대값 모드 · 크리/코어 난수 없음' : `케이스당 ${n}회`,
    expected ? '' : seed_txt,
    cases.length ? `전투 ${fmt(cases[0]!['duration'], '.0f')}초` : '',
    `생성 ${now}`,
  ];
  const chip_html = chips.filter((t) => t).map((t) => `<span class="chip">${esc(t)}</span>`).join('');

  // 이미지 CSS는 패널 생성보다 먼저 만들어야 한다 (_IMG_CLASS를 채운다).
  const img_css = _img_css(cases.flatMap((c) => c['squad'] as string[]));

  // 덱군이 있으면 덱군별, 아니면 variant(조건 축)별로 탭을 만든다.
  const groups = new Map<string, Array<Record<string, any>>>();
  for (const c of cases) {
    const k = truthy(get(c, 'group')) ? c['group'] : get(c, 'variant', '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  // 막대 길이는 **전 탭 통틀어** 최고 총딜 기준.
  const totals = cases.map((c) => sum(c['chars'].map((x: any) => x['mean'])));
  const global_hi_char = (totals.length ? totals.reduce((a, b) => (b > a ? b : a)) : 1) || 1;

  const tabs: string[] = []; const panels: string[] = [];
  [...groups].forEach(([vname, gcases], i) => {
    const act = i === 0 ? ' on' : '';
    const label = vname || '전체';
    tabs.push(`<button class="tab${act}" data-panel="p${i}">${esc(label)}</button>`);

    const squads = gcases.map((c) => (c['squad'] as string[]).join('\u0000'));
    const show_name = new Set(squads).size < squads.length;

    const enemies = new Set(gcases.map((c) => dumps(truthy(c['enemy']) ? c['enemy'] : {}, { sortKeys: true })));
    let boss: string;
    if (enemies.size === 1) {
      boss = `<div class="boss"><b>랩쳐</b> ${esc(_enemy_desc(gcases[0]!['enemy']))}</div>`;
    } else {
      const rows = gcases.map((c) => `<div><b>${esc(c['name'])}</b> ${esc(_enemy_desc(c['enemy']))}</div>`).join('');
      boss = `<div class="boss"><b>랩쳐 (케이스별 상이)</b>${rows}</div>`;
    }

    const [ops_top, ops_case] = _ops(spec, gcases);

    panels.push(`
<div class="panel" id="p${i}"${i === 0 ? '' : ' hidden'}>
  ${boss}
  ${ops_top}

  <h2>케이스 요약</h2>
  <div class="cases">${gcases.map((c) => hooks.case_card(c, show_name, ops_case.get(c['name']) ?? '')).join('')}</div>

  <h2>캐릭터 기여도</h2>
  <div class="card">
    <h3>케이스별 캐릭터 딜 (막대 길이 = 총딜, 전 탭 최고 케이스 기준)</h3>
    ${gcases.map((c) => _contrib_block(c, global_hi_char)).join('')}
  </div>

  <h2>캐릭터별 딜 상세</h2>
  <div class="card" style="padding-top:0">${gcases.map((c) => _char_detail(c)).join('')}</div>
</div>`);
  });

  const tab_html = groups.size > 1 ? `<div class="tabs">${tabs.join('')}</div>` : '';
  const note = truthy(get(spec, 'note')) ? `<p class="sub">${esc(spec['note'])}</p>` : '';

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec['title'])} — 딜량 보고서</title>
<style>${_CSS}
${img_css}</style></head>
<body><div class="wrap">
  <h1>${esc(spec['title'])}</h1>
  ${note}
  <div class="chips">${chip_html}</div>
  ${tab_html}
  ${panels.join('')}

  <h2>원자료 · 설정</h2>
  <div class="card" style="padding-top:0">
    ${_raw_table(cases, seeds)}
    ${_config_block(spec, cases)}
  </div>

  <p class="foot">
    ${foot_txt}
  </p>
</div>
<div id="tip"></div>
<script>${_JS}</script>
</body></html>`;
}
